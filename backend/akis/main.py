import hashlib,hmac,json,math,re,threading
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit,quote
from uuid import UUID,uuid4
from zoneinfo import ZoneInfo
from fastapi import FastAPI,Request,HTTPException,Depends,UploadFile,File,BackgroundTasks
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse,FileResponse,RedirectResponse
from pydantic import BaseModel,Field
from typing import Literal
from sqlalchemy import select,update,delete,func
from sqlalchemy.exc import IntegrityError
from .config import settings
from .db import Session
from .models import Content,ContentPlatform,Credential,MediaAsset,OAuthApp,AppSetting,Broadcast,DeliveryAttempt,Company,User,Membership,now
from .security import encrypt,decrypt,sign,raw_key,make_user_session,read_session,verify_password,password_hash,totp_secret,totp_verify
from .media import media_url,path_for,public_base
from .tokens import can_refresh,refresh_credential
from .errors import PlatformError
from .oauth import router,begin
from .access import Actor,require,current_user,session_user,audit,ensure_bootstrap,first_system_admin,memberships_json,resolve_company,PERMISSIONS
from . import storage

Platform=Literal['x','instagram','tiktok','whatsapp']

@asynccontextmanager
async def lifespan(app):
    raw_key()
    if not settings.local_mode and not settings.admin_password_hash: raise RuntimeError('Set ADMIN_PASSWORD_HASH for server mode')
    storage.enabled()
    ensure_bootstrap()
    stop=threading.Event()
    if settings.queue_mode=='local':
        from .jobs import local_worker
        threading.Thread(target=local_worker,args=(stop,),daemon=True).start()
    yield
    stop.set()

app=FastAPI(title='Akış API',lifespan=lifespan,docs_url='/api/docs' if settings.local_mode else None,redoc_url=None)
app.include_router(router)
from .admin import router as admin_router
app.include_router(admin_router)

def allowed_origins():
    with Session() as db: public=public_base(db)
    return {settings.app_origin.rstrip('/'),public} - {''}

@app.middleware('http')
async def guards(req,call_next):
    if settings.local_mode and req.url.hostname not in ('localhost','127.0.0.1','testserver'):
        return JSONResponse({'error':'Yerel mod yalnızca bu bilgisayardan kullanılabilir.'},403)
    if req.method not in ('GET','HEAD','OPTIONS'):
        if req.headers.get('origin','') not in allowed_origins(): return JSONResponse({'error':'İstek kaynağı doğrulanamadı.'},403)
    response=await call_next(req)
    if not req.url.path.endswith('/file'): response.headers['Cache-Control']='no-store'
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Referrer-Policy']='no-referrer'
    return response

@app.exception_handler(HTTPException)
async def http_error(req,exc):
    body=exc.detail if isinstance(exc.detail,dict) else {'error':str(exc.detail)}
    return JSONResponse(body,exc.status_code)
@app.exception_handler(RequestValidationError)
async def validation_error(req,exc): return JSONResponse({'error':'Alanları kontrol et: '+', '.join('.'.join(map(str,e['loc'][1:])) for e in exc.errors())},422)
@app.exception_handler(PlatformError)
async def platform_error(req,exc): return JSONResponse({'error':exc.message,'code':exc.code},400)

def set_session(response,user):
    response.set_cookie('akis_session',make_user_session(user.id,user.session_version),httponly=True,samesite='lax',secure=settings.app_origin.startswith('https'),max_age=43200)

@app.get('/api/health')
def health(): return {'ok':True,'queue':settings.queue_mode}

# ---------- Session, login, account ----------

def me_json(db,user):
    return {'id':user.id,'email':user.email,'name':user.name,'is_system_admin':user.is_system_admin,'totp_enabled':user.totp_enabled,'must_change_password':user.must_change_password,'companies':memberships_json(db,user.id)}

@app.get('/api/session')
def session(req:Request):
    if req.headers.get('sec-fetch-site')=='cross-site': raise HTTPException(403,'İstek kaynağı doğrulanamadı.')
    with Session() as db:
        user=session_user(db,req);fresh=False
        if not user and settings.local_mode:
            # Loopback-only convenience: sign in as the first system admin. Log out to test other users.
            ensure_bootstrap();user=first_system_admin(db);fresh=bool(user) and req.cookies.get('akis_logged_out')!='1'
            if not fresh: user=None
        r=JSONResponse({'authenticated':bool(user),'local':settings.local_mode,'queue':settings.queue_mode,'storage':'cloudinary' if storage.enabled() else 'local','user':me_json(db,user) if user else None})
        if fresh: set_session(r,user)
        return r

class LoginInput(BaseModel):
    email:str=Field(default='',max_length=254)
    password:str=Field(max_length=300)
    code:str=Field(default='',max_length=12)

@app.post('/api/login')
def login(data:LoginInput,req:Request):
    email=(data.email or settings.admin_email).strip().lower()
    identifier='login:'+hashlib.sha256(((req.client.host if req.client else 'unknown')+'|'+email).encode()).hexdigest()
    with Session() as db:
        row=db.get(AppSetting,identifier);info=json.loads(row.value) if row else {'count':0,'until':0}
        if info['until']>now() and info['count']>=5: raise HTTPException(429,'Çok fazla deneme yapıldı. 15 dakika sonra tekrar dene.')
        user=db.scalar(select(User).where(User.email==email))
        ok=bool(user) and not user.disabled and verify_password(data.password,user.password_hash)
        if ok and user.totp_enabled:
            if not data.code: raise HTTPException(401,{'error':'Doğrulama uygulamandaki 6 haneli kodu gir.','needs_code':True})
            ok=totp_verify(decrypt(user.totp_secret),data.code)
        if not ok:
            if info['until']<=now(): info={'count':0,'until':now()+900}
            info['count']+=1
            if not row: row=AppSetting(key=identifier,value='');db.add(row)
            row.value=json.dumps(info);db.commit()
            raise HTTPException(401,{'error':'E-posta, parola veya doğrulama kodu yanlış.','needs_code':bool(user and user.totp_enabled and data.code)})
        if row: db.delete(row)
        audit(db,Actor(user.id,user.email,user.is_system_admin),'user.login','user',user.id,company_id=None,two_factor=user.totp_enabled)
        db.commit()
        r=JSONResponse({'ok':True});set_session(r,user);r.delete_cookie('akis_logged_out');return r

@app.post('/api/logout')
def logout():
    r=JSONResponse({'ok':True});r.delete_cookie('akis_session')
    if settings.local_mode: r.set_cookie('akis_logged_out','1',httponly=True,samesite='lax',max_age=43200)
    return r

class PasswordInput(BaseModel):
    current:str=Field(max_length=300)
    new:str=Field(min_length=10,max_length=300)

@app.post('/api/me/password')
def change_password(data:PasswordInput,actor=Depends(current_user)):
    with Session() as db:
        user=db.get(User,actor.user_id)
        if not verify_password(data.current,user.password_hash): raise HTTPException(400,'Mevcut parola yanlış.')
        user.password_hash=password_hash(data.new);user.session_version+=1;user.must_change_password=False
        audit(db,actor,'user.password_changed','user',user.id,company_id=None);db.commit()
        r=JSONResponse({'ok':True});set_session(r,user);return r

@app.post('/api/me/2fa/setup')
def totp_setup(actor=Depends(current_user)):
    with Session() as db:
        user=db.get(User,actor.user_id)
        if user.totp_enabled: raise HTTPException(400,'İki aşamalı giriş zaten açık.')
        secret=totp_secret();user.totp_secret=encrypt(secret);db.commit()
    label=quote(f'Akış:{actor.email}')
    return {'secret':secret,'uri':f'otpauth://totp/{label}?secret={secret}&issuer=Ak%C4%B1%C5%9F&digits=6&period=30'}

class CodeInput(BaseModel):
    code:str=Field(max_length=12)
    password:str=Field(default='',max_length=300)

@app.post('/api/me/2fa/enable')
def totp_enable(data:CodeInput,actor=Depends(current_user)):
    with Session() as db:
        user=db.get(User,actor.user_id)
        if not user.totp_secret or not totp_verify(decrypt(user.totp_secret),data.code): raise HTTPException(400,'Kod doğrulanamadı. Uygulamadaki güncel kodu gir.')
        user.totp_enabled=True;user.session_version+=1
        audit(db,actor,'user.2fa_enabled','user',user.id,company_id=None);db.commit()
        r=JSONResponse({'ok':True});set_session(r,user);return r

@app.post('/api/me/2fa/disable')
def totp_disable(data:CodeInput,actor=Depends(current_user)):
    with Session() as db:
        user=db.get(User,actor.user_id)
        if not user.totp_enabled: return {'ok':True}
        if not verify_password(data.password,user.password_hash) or not totp_verify(decrypt(user.totp_secret),data.code): raise HTTPException(400,'Parola veya doğrulama kodu yanlış.')
        user.totp_enabled=False;user.totp_secret=None;user.session_version+=1
        audit(db,actor,'user.2fa_disabled','user',user.id,company_id=None);db.commit()
        r=JSONResponse({'ok':True});set_session(r,user);return r

# ---------- Company state ----------

def asset_json(a,db):
    return {'id':a.id,'filename':a.filename,'mime_type':a.mime_type,'width':a.width,'height':a.height,'duration_seconds':a.duration_seconds,'size':a.size,'status':a.status,'note':a.note,'error':a.error,'is_auto_generated':a.is_auto_generated,'folder':a.folder,'tags':a.tags or [],'archived':a.archived,'created_at':a.created_at,'stored':'cloudinary' if a.remote_url else 'local','url':media_url(a,db) if a.status=='ready' else None}

def post_json(p,rows,attempts,assets,people):
    return {'id':p.id,'text':p.body_text,'status':p.status,'created':p.created_at*1000,'platforms':p.platforms,'asset':assets.get(p.asset_id),'options':p.options,
        'scheduled_at':p.scheduled_at,'created_by':people.get(p.created_by,''),'approved_by':people.get(p.approved_by,''),'approved_at':p.approved_at,'review_note':p.review_note,
        'deliveries':[{'id':r.id,'platform':r.platform,'recipient':r.recipient,'status':r.status,'error':r.error_message,'error_code':r.error_code,'externalId':r.external_post_id,'retry_count':r.retry_count,'next_attempt_at':r.next_attempt_at,'sent_at':r.sent_at,'media_note':r.progress.get('media_note'),
            'attempts':[{'started_at':a.started_at,'finished_at':a.finished_at,'stage':a.stage,'outcome':a.outcome,'error_code':a.error_code,'error':a.error_message} for a in attempts.get(r.id,[])]} for r in rows if r.content_id==p.id]}

@app.get('/api/state')
def state(actor=Depends(require('read'))):
    cid=actor.company_id
    with Session() as db:
        company=db.get(Company,cid)
        creds=list(db.scalars(select(Credential).where(Credential.company_id==cid)))
        posts=list(db.scalars(select(Content).where(Content.company_id==cid).order_by(Content.created_at.desc()).limit(300)))
        ids=[p.id for p in posts]
        rows=list(db.scalars(select(ContentPlatform).where(ContentPlatform.content_id.in_(ids)))) if ids else []
        attempts={}
        if rows:
            for a in db.scalars(select(DeliveryAttempt).where(DeliveryAttempt.delivery_id.in_([r.id for r in rows])).order_by(DeliveryAttempt.started_at.desc())):
                attempts.setdefault(a.delivery_id,[]).append(a)
        assets={a.id:asset_json(a,db) for a in db.scalars(select(MediaAsset).where(MediaAsset.company_id==cid,MediaAsset.variant=='source').order_by(MediaAsset.created_at.desc()).limit(500))}
        people={u.id:(u.name or u.email) for u in db.scalars(select(User).join(Membership,Membership.user_id==User.id).where(Membership.company_id==cid))}
        apps=list(db.scalars(select(OAuthApp).where(OAuthApp.company_id==cid))) if actor.can('settings') else []
        return {'company':{'id':company.id,'name':company.name,'timezone':company.timezone,'require_approval':company.require_approval},
        'me':{'role':actor.role,'permissions':sorted(PERMISSIONS[actor.role])},
        'connections':[{'id':c.id,'platform':c.platform,'account':c.account_id,'label':c.account_label,'expires_at':c.expires_at,'refresh_expires_at':c.refresh_expires_at,'can_refresh':can_refresh(c),'refresh_error':c.refresh_error,'token_kind':c.token_kind,'days_left':math.ceil((c.expires_at-now())/86400) if c.expires_at else None,'has_refresh':bool(c.refresh_token),'connected_by':people.get(c.connected_by,'')} for c in creds],
        'posts':[post_json(p,rows,attempts,assets,people) for p in posts],
        'assets':[a for a in assets.values() if not a['archived']],
        'settings':{'public_base_url':public_base(db),'app_origin':settings.app_origin,'queue':settings.queue_mode,'storage':'cloudinary' if storage.enabled() else 'local','max_upload_mb':settings.max_upload_mb,'oauth_apps':[{'platform':a.platform,'client_id':a.client_id,'has_secret':bool(a.client_secret),'redirect_uri':a.redirect_uri,'mode':a.mode} for a in apps]}}

# ---------- Connections (company admin) ----------

class CredentialInput(BaseModel):
    platform:Platform
    token:str=Field(default='',max_length=8000)
    refresh_token:str=Field(default='',max_length=8000)
    account:str=Field(default='',max_length=100)
    label:str=Field(default='',max_length=120)
    expires_at:int|None=None
    refresh_expires_at:int|None=None
    token_kind:Literal['manual','long_lived']='manual'

@app.post('/api/connections')
def save_credential(data:CredentialInput,actor=Depends(require('connections'))):
    if data.platform in ('instagram','whatsapp') and not data.account.isdigit(): raise HTTPException(400,'Geçerli bir hesap/telefon numarası ID gir.')
    with Session() as db:
        c=db.scalar(select(Credential).where(Credential.company_id==actor.company_id,Credential.platform==data.platform))
        if not c and not data.token.strip(): raise HTTPException(400,'Erişim anahtarını gir.')
        if not c: c=Credential(company_id=actor.company_id,platform=data.platform,access_token='');db.add(c)
        if data.token.strip():
            c.access_token=encrypt(data.token.strip());c.refresh_token=encrypt(data.refresh_token.strip());c.updated_at=now();c.connected_by=actor.user_id
        elif data.refresh_token.strip(): c.refresh_token=encrypt(data.refresh_token.strip())
        c.account_id=data.account;c.account_label=data.label;c.expires_at=data.expires_at;c.refresh_expires_at=data.refresh_expires_at;c.token_kind=data.token_kind;c.refresh_error=None
        audit(db,actor,'connection.saved','credential',data.platform,account=data.label or data.account,token_changed=bool(data.token.strip()))
        db.commit()
    return {'ok':True}

class PlatformInput(BaseModel): platform:Platform
@app.delete('/api/connections')
def remove_credential(data:PlatformInput,actor=Depends(require('connections'))):
    with Session() as db:
        c=db.scalar(select(Credential).where(Credential.company_id==actor.company_id,Credential.platform==data.platform))
        if c: db.delete(c);audit(db,actor,'connection.removed','credential',data.platform);db.commit()
    return {'ok':True}

@app.post('/api/connections/refresh')
def refresh_connection(data:PlatformInput,actor=Depends(require('connections'))):
    with Session() as db:
        c=db.scalar(select(Credential).where(Credential.company_id==actor.company_id,Credential.platform==data.platform))
        if not c or not can_refresh(c): raise HTTPException(400,'Bu bağlantı otomatik yenilenemiyor. Yeniden bağlan seçeneğini kullan.')
        identifier=c.id
    refresh_credential(identifier,True);return {'ok':True}

class OAuthInput(BaseModel): platform:Platform;account:str=Field(default='',max_length=100)
@app.post('/api/oauth/start')
def start_oauth(data:OAuthInput,req:Request,actor=Depends(require('connections'))):
    with Session() as db: return {'url':begin(db,data.platform,actor,req.cookies['akis_session'],data.account)}

class AppInput(BaseModel):
    platform:Platform
    client_id:str=Field(min_length=1,max_length=250)
    client_secret:str=Field(default='',max_length=4000)
    redirect_uri:str=Field(max_length=600)
    mode:Literal['web','desktop']='web'

@app.post('/api/settings/oauth')
def save_app(data:AppInput,actor=Depends(require('settings'))):
    uri=urlsplit(data.redirect_uri)
    if uri.query or uri.fragment or uri.username or uri.password or uri.path!=f'/api/oauth/{data.platform}/callback': raise HTTPException(400,'Dönüş adresi /api/oauth/'+data.platform+'/callback ile bitmeli; sorgu veya kullanıcı bilgisi içermemeli.')
    if uri.scheme!='https' and not(uri.scheme=='http' and uri.hostname in ('localhost','127.0.0.1')): raise HTTPException(400,'HTTPS adresi veya yerel geliştirme adresi kullan.')
    if data.platform=='tiktok':
        if data.mode=='web' and (uri.scheme!='https' or uri.hostname in ('localhost','127.0.0.1')): raise HTTPException(400,'TikTok Web için herkese açık HTTPS dönüş adresi gerekir. Yerel uygulama için Desktop modunu seç.')
        if data.mode=='desktop' and (uri.hostname not in ('localhost','127.0.0.1') or not uri.port): raise HTTPException(400,'TikTok Desktop için port içeren localhost veya 127.0.0.1 dönüş adresi kullan.')
    with Session() as db:
        a=db.get(OAuthApp,(actor.company_id,data.platform))
        if not a: a=OAuthApp(company_id=actor.company_id,platform=data.platform,client_id=data.client_id,redirect_uri=data.redirect_uri);db.add(a)
        if not data.client_secret and not a.client_secret and data.platform!='x': raise HTTPException(400,'Uygulama gizli anahtarını gir.')
        a.client_id=data.client_id;a.redirect_uri=data.redirect_uri;a.mode=data.mode
        if data.client_secret: a.client_secret=encrypt(data.client_secret)
        audit(db,actor,'settings.oauth_app','oauth_app',data.platform,secret_changed=bool(data.client_secret))
        db.commit()
    return {'ok':True}

class PublicInput(BaseModel): public_base_url:str=Field(max_length=500)
@app.post('/api/settings/public')
def save_public(data:PublicInput,actor=Depends(current_user)):
    # The server's public address is shared by every company, so only system admins change it.
    if not actor.is_system_admin: raise HTTPException(403,'Sunucu adresini yalnızca sistem yöneticisi değiştirebilir.')
    value=data.public_base_url.rstrip('/')
    if value:
        u=urlsplit(value)
        if u.scheme!='https' or not u.hostname or u.path or u.query or u.fragment or u.username or u.password: raise HTTPException(400,'Yalnızca HTTPS alan adını gir. Örnek: https://akis.ornek.com')
    with Session() as db:
        row=db.get(AppSetting,'public_base_url')
        if not row: row=AppSetting(key='public_base_url',value=value);db.add(row)
        else: row.value=value
        audit(db,actor,'system.public_url','setting','public_base_url',company_id=None,value=value);db.commit()
    return {'ok':True}

# ---------- Media library ----------

@app.post('/api/media',status_code=202)
async def upload(file:UploadFile=File(...),actor=Depends(require('media'))):
    identifier=str(uuid4());path=path_for(identifier+'.upload');size=0
    try:
        with path.open('wb') as target:
            while chunk:=await file.read(1024*1024):
                size+=len(chunk)
                if size>settings.max_upload_mb*1024*1024: raise HTTPException(413,f'Dosya en fazla {settings.max_upload_mb} MB olabilir.')
                target.write(chunk)
        if size==0: raise HTTPException(400,'Dosya boş.')
        # Sniff actual decoded image bytes; never trust a browser-supplied MIME type.
        from PIL import Image
        import pillow_heif
        pillow_heif.register_heif_opener()
        try:
            with Image.open(path) as image:
                image.verify();mime='image/'+str(image.format or 'unknown').lower()
        except Exception:
            with path.open('rb') as f: header=f.read(32)
            if header[4:8]!=b'ftyp' and not header.startswith(b'\x1aE\xdf\xa3'): raise HTTPException(400,'JPEG, PNG, WebP, HEIC, MP4, MOV veya WebM dosyası yükle.')
            mime='video/mp4'
        with Session() as db:
            a=MediaAsset(id=identifier,company_id=actor.company_id,uploaded_by=actor.user_id,filename=Path(file.filename or 'medya').name[:240],storage_key=path.name,mime_type=mime,size=size,status='processing')
            db.add(a);audit(db,actor,'media.uploaded','media',identifier,filename=a.filename,size=size);db.commit();result=asset_json(a,db)
        return result
    except Exception:
        path.unlink(missing_ok=True);raise
    finally: await file.close()

def company_asset(db,identifier,actor):
    a=db.get(MediaAsset,identifier)
    if not a or a.company_id!=actor.company_id: raise HTTPException(404,'Medya bulunamadı.')
    return a

@app.get('/api/media')
def list_media(folder:str='',tag:str='',q:str='',archived:bool=False,actor=Depends(require('read'))):
    with Session() as db:
        query=select(MediaAsset).where(MediaAsset.company_id==actor.company_id,MediaAsset.variant=='source',MediaAsset.archived==archived)
        if folder: query=query.where(MediaAsset.folder==folder)
        if q: query=query.where(MediaAsset.filename.ilike(f'%{q}%'))
        items=[asset_json(a,db) for a in db.scalars(query.order_by(MediaAsset.created_at.desc()).limit(500))]
        if tag: items=[a for a in items if tag in a['tags']]
        folders=sorted({f for f in db.scalars(select(MediaAsset.folder).where(MediaAsset.company_id==actor.company_id)) if f})
        return {'items':items,'folders':folders}

@app.get('/api/media/{identifier}')
def get_asset(identifier:str,actor=Depends(require('read'))):
    with Session() as db: return asset_json(company_asset(db,identifier,actor),db)

class AssetEdit(BaseModel):
    folder:str|None=Field(default=None,max_length=80)
    tags:list[str]|None=Field(default=None,max_length=20)
    archived:bool|None=None

@app.patch('/api/media/{identifier}')
def edit_asset(identifier:str,data:AssetEdit,actor=Depends(require('media'))):
    with Session() as db:
        a=company_asset(db,identifier,actor)
        if data.folder is not None: a.folder=data.folder.strip()
        if data.tags is not None: a.tags=sorted({t.strip().lower()[:40] for t in data.tags if t.strip()})
        if data.archived is not None: a.archived=data.archived
        a.updated_at=now();audit(db,actor,'media.updated','media',a.id,folder=a.folder,tags=a.tags,archived=a.archived);db.commit()
        return asset_json(a,db)

@app.delete('/api/media/{identifier}')
def delete_asset(identifier:str,actor=Depends(require('media'))):
    with Session() as db:
        a=company_asset(db,identifier,actor)
        if db.scalar(select(func.count()).select_from(Content).where(Content.asset_id==a.id,Content.status.not_in(('draft','rejected')))):
            raise HTTPException(400,'Bu medya gönderilmiş veya onay bekleyen bir içerikte kullanılıyor. Silmek yerine arşivle.')
        variants=list(db.scalars(select(MediaAsset).where(MediaAsset.source_asset_id==a.id)))
        for item in variants+[a]:
            try: storage.delete(item)
            except Exception: raise HTTPException(502,'Medya depolama alanından silinemedi. Biraz sonra tekrar dene.')
            if item.storage_key: path_for(item.storage_key).unlink(missing_ok=True)
        db.execute(update(Content).where(Content.asset_id==a.id).values(asset_id=None))
        for item in variants: db.delete(item)
        db.flush();db.delete(a);audit(db,actor,'media.deleted','media',identifier,filename=a.filename);db.commit()
    return {'ok':True}

@app.get('/api/media/{identifier}/file')
def serve_media(identifier:str,req:Request,expires:int=0,signature:str=''):
    signed=now()<expires<=now()+86400*3 and hmac.compare_digest(signature,sign(f'{identifier}:{expires}'))
    with Session() as db:
        a=db.get(MediaAsset,identifier)
        if not signed:
            user=session_user(db,req)
            if not user: raise HTTPException(403,'Medya bağlantısının süresi dolmuş veya erişim izni yok.')
            if not a or not db.scalar(select(Membership.id).where(Membership.user_id==user.id,Membership.company_id==a.company_id)): raise HTTPException(404,'Medya bulunamadı.')
        if not a or a.status!='ready': raise HTTPException(404,'Medya bulunamadı.')
        local=path_for(a.storage_key)
        if not local.exists() and a.remote_url: return RedirectResponse(a.remote_url,302)
        return FileResponse(local,media_type=a.mime_type,headers={'Cache-Control':'private, max-age=300','Content-Disposition':'inline'})

# ---------- Content: drafts, approval, scheduling ----------

class ContentInput(BaseModel):
    requestId:UUID|None=None
    text:str=Field(default='',max_length=5000)
    platforms:list[Platform]=Field(min_length=1,max_length=4)
    asset_id:str|None=None
    send:bool=False
    scheduled_local:str=Field(default='',max_length=20)
    recipients:list[str]=Field(default_factory=list,max_length=100)
    template:str=Field(default='',max_length=150)
    language:str=Field(default='tr',max_length=12)
    template_params:list[str]=Field(default_factory=list,max_length=20)
    wa_mode:Literal['template','session']='template'
    session_confirmed:bool=False

def schedule_epoch(value,timezone):
    """'YYYY-MM-DDTHH:MM' in the company's timezone → unix seconds. Empty means now."""
    if not value: return None
    try: moment=datetime.strptime(value,'%Y-%m-%dT%H:%M').replace(tzinfo=ZoneInfo(timezone))
    except ValueError: raise HTTPException(400,'Paylaşım zamanını YYYY-AA-GGTSS:DD biçiminde gir.')
    stamp=int(moment.timestamp())
    if stamp<now()-60: raise HTTPException(400,'Paylaşım zamanı geçmişte olamaz.')
    if stamp>now()+86400*365: raise HTTPException(400,'Paylaşım en fazla bir yıl sonrasına planlanabilir.')
    return stamp

def validate_send(db,company_id,platforms,text,asset,options):
    if asset and asset.status=='failed': raise HTTPException(400,asset.error or 'Medya hazırlanamadı.')
    if 'x' in platforms and len(text)>280: raise HTTPException(400,'X metnini 280 karakterin altına indir.')
    if 'instagram' in platforms and len(text)>2200: raise HTTPException(400,'Instagram açıklaması en fazla 2200 karakter olabilir.')
    if any(p in platforms for p in ('instagram','tiktok')) and not asset: raise HTTPException(400,'Instagram ve TikTok için bir dosya yükle.')
    if 'whatsapp' in platforms:
        recipients=options['recipients']
        if not recipients or any(not re.fullmatch(r'\d{8,15}',r) for r in recipients): raise HTTPException(400,'WhatsApp alıcılarını ülke koduyla, yalnızca rakam kullanarak gir.')
        if options['wa_mode']=='template' and (not re.fullmatch(r'\w+',options['template']) or not re.fullmatch(r'\w{2,12}',options['language'])): raise HTTPException(400,'Şablon adını ve onaylı dil kodunu gir.')
        if options['wa_mode']=='session' and not options['session_confirmed']: raise HTTPException(400,'Serbest mesaj için alıcının son 24 saat içinde mesaj gönderdiğini doğrula veya şablon kullan.')
    connected={c.platform for c in db.scalars(select(Credential).where(Credential.company_id==company_id))}
    if any(p not in connected for p in platforms): raise HTTPException(400,'Önce seçilen hesapları Bağlantılar ekranından bağla.')

def queue_deliveries(db,content,actor):
    """Approved content → one delivery row per platform/recipient, due at the scheduled time."""
    due=content.scheduled_at or now()
    db.execute(delete(ContentPlatform).where(ContentPlatform.content_id==content.id,ContentPlatform.status=='pending'))
    recipients=content.options.get('recipients',[])
    for platform in content.platforms:
        for recipient in recipients if platform=='whatsapp' else ['']:
            db.add(ContentPlatform(content_id=content.id,platform=platform,recipient=recipient,status='pending',next_attempt_at=due))
    if 'whatsapp' in content.platforms and not db.scalar(select(Broadcast).where(Broadcast.content_id==content.id)):
        db.add(Broadcast(content_id=content.id,template_id=content.options.get('template',''),recipient_list=recipients))
    content.approved_by=actor.user_id;content.approved_at=now()
    content.status='scheduled' if due>now()+30 else 'processing'

def apply_input(db,content,data,actor,company):
    asset=db.get(MediaAsset,data.asset_id) if data.asset_id else None
    if data.asset_id and (not asset or asset.company_id!=actor.company_id): raise HTTPException(400,'Seçilen medya bulunamadı.')
    if not data.text.strip() and not asset and not data.template: raise HTTPException(400,'Metin, medya veya mesaj şablonu ekle.')
    options={k:getattr(data,k) for k in ('recipients','template','language','template_params','wa_mode','session_confirmed')}
    options['recipients']=list(dict.fromkeys(data.recipients))
    platforms=list(dict.fromkeys(data.platforms))
    content.body_text=data.text.strip();content.platforms=platforms;content.asset_id=data.asset_id;content.options=options
    content.scheduled_at=schedule_epoch(data.scheduled_local,company.timezone);content.updated_at=now();content.review_note=''
    if asset and not asset.content_id: asset.content_id=content.id
    if data.send:
        validate_send(db,actor.company_id,platforms,content.body_text,asset,options)
        content.submitted_by=actor.user_id
        if actor.can('approve') or not company.require_approval:
            queue_deliveries(db,content,actor);return 'approved'
        content.status='pending_approval';return 'submitted'
    content.status='draft';return 'draft'

def after_commit(background,content_id,outcome):
    if outcome=='approved':
        from .jobs import enqueue_content
        background.add_task(enqueue_content,content_id)

@app.post('/api/posts',status_code=202)
def create_content(data:ContentInput,background:BackgroundTasks,actor=Depends(require('compose'))):
    if not data.requestId: raise HTTPException(400,'İstek kimliği eksik.')
    identifier=str(data.requestId)
    fingerprint=hashlib.sha256(json.dumps(data.model_dump(mode='json',exclude={'requestId'}),sort_keys=True).encode()).hexdigest()
    with Session() as db:
        existing=db.get(Content,identifier)
        if existing:
            if existing.company_id!=actor.company_id or existing.fingerprint!=fingerprint: raise HTTPException(409,'Bu istek daha önce farklı içerikle kaydedilmiş. Gönderiler ekranını kontrol et.')
            return {'id':identifier,'alreadySaved':True}
        company=db.get(Company,actor.company_id)
        p=Content(id=identifier,company_id=actor.company_id,created_by=actor.user_id,fingerprint=fingerprint);db.add(p);db.flush()
        outcome=apply_input(db,p,data,actor,company)
        audit(db,actor,'content.'+{'draft':'draft_saved','submitted':'submitted','approved':'approved'}[outcome],'content',identifier,platforms=p.platforms,scheduled_at=p.scheduled_at)
        try: db.commit()
        except IntegrityError:
            db.rollback();old=db.get(Content,identifier)
            if old and old.company_id==actor.company_id and old.fingerprint==fingerprint: return {'id':identifier,'alreadySaved':True}
            raise HTTPException(409,'İstek kaydedilemedi. Gönderiler ekranını kontrol et.')
    after_commit(background,identifier,outcome)
    return {'id':identifier,'queued':outcome=='approved','outcome':outcome}

def company_content(db,identifier,actor):
    p=db.get(Content,identifier)
    if not p or p.company_id!=actor.company_id: raise HTTPException(404,'İçerik bulunamadı.')
    return p

@app.put('/api/posts/{identifier}')
def edit_content(identifier:str,data:ContentInput,background:BackgroundTasks,actor=Depends(require('compose'))):
    with Session() as db:
        p=company_content(db,identifier,actor)
        if p.status not in ('draft','rejected','pending_approval'): raise HTTPException(400,'Yalnızca taslak, reddedilen veya onay bekleyen içerikler düzenlenebilir.')
        outcome=apply_input(db,p,data,actor,db.get(Company,actor.company_id))
        audit(db,actor,'content.edited','content',identifier,outcome=outcome);db.commit()
    after_commit(background,identifier,outcome)
    return {'id':identifier,'outcome':outcome}

class ReviewInput(BaseModel): note:str=Field(default='',max_length=1000)

@app.post('/api/posts/{identifier}/approve')
def approve_content(identifier:str,data:ReviewInput,background:BackgroundTasks,actor=Depends(require('approve'))):
    with Session() as db:
        p=company_content(db,identifier,actor)
        if p.status!='pending_approval': raise HTTPException(400,'Bu içerik onay beklemiyor.')
        if p.scheduled_at and p.scheduled_at<now()-60: raise HTTPException(400,'Planlanan zaman geçti. İçeriği düzenleyip yeni bir zaman seç.')
        validate_send(db,actor.company_id,p.platforms,p.body_text,db.get(MediaAsset,p.asset_id) if p.asset_id else None,{**{'recipients':[],'wa_mode':'template','template':'','language':'tr','session_confirmed':False},**p.options})
        queue_deliveries(db,p,actor);p.review_note=data.note.strip()
        audit(db,actor,'content.approved','content',identifier,note=p.review_note,scheduled_at=p.scheduled_at);db.commit()
    after_commit(background,identifier,'approved')
    return {'ok':True}

@app.post('/api/posts/{identifier}/reject')
def reject_content(identifier:str,data:ReviewInput,actor=Depends(require('approve'))):
    if not data.note.strip(): raise HTTPException(400,'Reddetme nedenini yaz; editör neyi düzelteceğini bilsin.')
    with Session() as db:
        p=company_content(db,identifier,actor)
        if p.status!='pending_approval': raise HTTPException(400,'Bu içerik onay beklemiyor.')
        p.status='rejected';p.review_note=data.note.strip();p.updated_at=now()
        audit(db,actor,'content.rejected','content',identifier,note=p.review_note);db.commit()
    return {'ok':True}

@app.post('/api/posts/{identifier}/cancel')
def cancel_schedule(identifier:str,actor=Depends(require('approve'))):
    with Session() as db:
        p=company_content(db,identifier,actor)
        rows=list(db.scalars(select(ContentPlatform).where(ContentPlatform.content_id==p.id)))
        if p.status!='scheduled' or any(r.status!='pending' or r.retry_count or r.progress for r in rows): raise HTTPException(400,'Gönderim başladığı için plan iptal edilemez.')
        for r in rows: db.delete(r)
        db.execute(delete(Broadcast).where(Broadcast.content_id==p.id))
        p.status='draft';p.approved_by=None;p.approved_at=None;p.updated_at=now()
        audit(db,actor,'content.schedule_cancelled','content',identifier);db.commit()
    return {'ok':True}

@app.delete('/api/posts/{identifier}')
def delete_content(identifier:str,actor=Depends(require('compose'))):
    with Session() as db:
        p=company_content(db,identifier,actor)
        if p.status not in ('draft','rejected'): raise HTTPException(400,'Yalnızca taslak veya reddedilen içerikler silinebilir.')
        db.execute(update(MediaAsset).where(MediaAsset.content_id==p.id).values(content_id=None))
        db.delete(p);audit(db,actor,'content.deleted','content',identifier);db.commit()
    return {'ok':True}

class RetryInput(BaseModel): delivery_id:str
@app.post('/api/retry')
def retry(data:RetryInput,actor=Depends(require('approve'))):
    with Session() as db:
        row=db.get(ContentPlatform,data.delivery_id);p=db.get(Content,row.content_id) if row else None
        if not row or not p or p.company_id!=actor.company_id: raise HTTPException(404,'Gönderi bulunamadı.')
        if row.status!='failed': raise HTTPException(400,'Yalnızca kesin başarısız gönderimler yeniden denenebilir.')
        changed=db.execute(update(ContentPlatform).where(ContentPlatform.id==row.id,ContentPlatform.status=='failed').values(status='pending',next_attempt_at=now(),retry_count=0,error_code=None,error_message=None,final_request_started=False)).rowcount
        p.status='processing';audit(db,actor,'delivery.retried','delivery',row.id,platform=row.platform);db.commit();return {'ok':bool(changed)}
