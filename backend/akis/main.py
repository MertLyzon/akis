import hashlib,hmac,json,math,re,secrets,threading,time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID,uuid4
from fastapi import FastAPI,Request,HTTPException,Depends,UploadFile,File,BackgroundTasks
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse,FileResponse
from pydantic import BaseModel,Field
from typing import Literal
from sqlalchemy import select,update
from sqlalchemy.exc import IntegrityError
from .config import settings
from .db import Session
from .models import Content,ContentPlatform,Credential,MediaAsset,OAuthApp,AppSetting,Broadcast,now
from .security import encrypt,decrypt,sign,raw_key,make_session,valid_session,check_password
from .media import media_url,path_for,public_base
from .tokens import can_refresh,refresh_credential
from .errors import PlatformError
from .oauth import router,begin

Platform=Literal['x','instagram','tiktok','whatsapp']
OWNER='local_seedy'

@asynccontextmanager
async def lifespan(app):
    raw_key()
    if not settings.local_mode and not settings.admin_password_hash: raise RuntimeError('Set ADMIN_PASSWORD_HASH for server mode')
    stop=threading.Event()
    if settings.queue_mode=='local':
        from .jobs import local_worker
        threading.Thread(target=local_worker,args=(stop,),daemon=True).start()
    yield
    stop.set()

app=FastAPI(title='Akış API',lifespan=lifespan,docs_url='/api/docs' if settings.local_mode else None,redoc_url=None)
app.include_router(router)

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
async def http_error(req,exc): return JSONResponse({'error':str(exc.detail)},exc.status_code)
@app.exception_handler(RequestValidationError)
async def validation_error(req,exc): return JSONResponse({'error':'Alanları kontrol et: '+', '.join('.'.join(map(str,e['loc'][1:])) for e in exc.errors())},422)
@app.exception_handler(PlatformError)
async def platform_error(req,exc): return JSONResponse({'error':exc.message,'code':exc.code},400)

def auth(req:Request):
    if not valid_session(req.cookies.get('akis_session','')): raise HTTPException(401,'Devam etmek için oturum aç.')
    return OWNER

@app.get('/api/health')
def health(): return {'ok':True,'queue':settings.queue_mode}

@app.get('/api/session')
def session(req:Request):
    if req.headers.get('sec-fetch-site')=='cross-site': raise HTTPException(403,'İstek kaynağı doğrulanamadı.')
    existing=req.cookies.get('akis_session','');logged=valid_session(existing)
    r=JSONResponse({'authenticated':logged or settings.local_mode,'local':settings.local_mode,'queue':settings.queue_mode})
    if settings.local_mode and not logged: r.set_cookie('akis_session',make_session(),httponly=True,samesite='lax',secure=False,max_age=43200)
    return r

class LoginInput(BaseModel): password:str=Field(max_length=300)
@app.post('/api/login')
def login(data:LoginInput,req:Request):
    identifier='login:'+hashlib.sha256((req.client.host if req.client else 'unknown').encode()).hexdigest()
    with Session() as db:
        row=db.get(AppSetting,identifier);info=json.loads(row.value) if row else {'count':0,'until':0}
        if info['until']>now() and info['count']>=5: raise HTTPException(429,'Çok fazla deneme yapıldı. 15 dakika sonra tekrar dene.')
        if not check_password(data.password):
            if info['until']<=now(): info={'count':0,'until':now()+900}
            info['count']+=1
            if not row: row=AppSetting(key=identifier,value='');db.add(row)
            row.value=json.dumps(info);db.commit();raise HTTPException(401,'Parola yanlış.')
        if row: db.delete(row);db.commit()
    r=JSONResponse({'ok':True});r.set_cookie('akis_session',make_session(),httponly=True,samesite='lax',secure=settings.app_origin.startswith('https'),max_age=43200);return r

def asset_json(a,db):
    return {'id':a.id,'filename':a.filename,'mime_type':a.mime_type,'width':a.width,'height':a.height,'duration_seconds':a.duration_seconds,'size':a.size,'status':a.status,'note':a.note,'error':a.error,'is_auto_generated':a.is_auto_generated,'url':media_url(a,db) if a.status=='ready' else None}

@app.get('/api/state')
def state(owner=Depends(auth)):
    with Session() as db:
        creds=list(db.scalars(select(Credential).where(Credential.owner==owner)))
        posts=list(db.scalars(select(Content).where(Content.created_by==owner).order_by(Content.created_at.desc()).limit(200)))
        rows=list(db.scalars(select(ContentPlatform).where(ContentPlatform.content_id.in_([p.id for p in posts])))) if posts else []
        assets={a.id:asset_json(a,db) for a in db.scalars(select(MediaAsset).where(MediaAsset.owner==owner,MediaAsset.variant=='source').order_by(MediaAsset.created_at.desc()).limit(300))}
        apps=list(db.scalars(select(OAuthApp)))
        return {'connections':[{'id':c.id,'platform':c.platform,'account':c.account_id,'label':c.account_label,'expires_at':c.expires_at,'refresh_expires_at':c.refresh_expires_at,'can_refresh':can_refresh(c),'refresh_error':c.refresh_error,'token_kind':c.token_kind,'days_left':math.ceil((c.expires_at-now())/86400) if c.expires_at else None,'has_refresh':bool(c.refresh_token)} for c in creds],
        'posts':[{'id':p.id,'text':p.body_text,'status':p.status,'created':p.created_at*1000,'platforms':p.platforms,'asset':assets.get(p.asset_id),'options':p.options,'deliveries':[{'id':r.id,'platform':r.platform,'recipient':r.recipient,'status':r.status,'error':r.error_message,'error_code':r.error_code,'externalId':r.external_post_id,'retry_count':r.retry_count,'next_attempt_at':r.next_attempt_at,'media_note':r.progress.get('media_note')} for r in rows if r.content_id==p.id]} for p in posts],
        'assets':list(assets.values()),'settings':{'public_base_url':public_base(db),'app_origin':settings.app_origin,'queue':settings.queue_mode,'max_upload_mb':settings.max_upload_mb,'oauth_apps':[{'platform':a.platform,'client_id':a.client_id,'has_secret':bool(a.client_secret),'redirect_uri':a.redirect_uri,'mode':a.mode} for a in apps]}}

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
def save_credential(data:CredentialInput,owner=Depends(auth)):
    if data.platform in ('instagram','whatsapp') and not data.account.isdigit(): raise HTTPException(400,'Geçerli bir hesap/telefon numarası ID gir.')
    with Session() as db:
        c=db.scalar(select(Credential).where(Credential.owner==owner,Credential.platform==data.platform))
        if not c and not data.token.strip(): raise HTTPException(400,'Erişim anahtarını gir.')
        if not c: c=Credential(owner=owner,platform=data.platform,access_token='');db.add(c)
        if data.token.strip():
            c.access_token=encrypt(data.token.strip());c.refresh_token=encrypt(data.refresh_token.strip());c.updated_at=now()
        elif data.refresh_token.strip(): c.refresh_token=encrypt(data.refresh_token.strip())
        c.account_id=data.account;c.account_label=data.label;c.expires_at=data.expires_at;c.refresh_expires_at=data.refresh_expires_at;c.token_kind=data.token_kind;c.refresh_error=None;db.commit()
    return {'ok':True}

class PlatformInput(BaseModel): platform:Platform
@app.delete('/api/connections')
def remove_credential(data:PlatformInput,owner=Depends(auth)):
    with Session() as db:
        c=db.scalar(select(Credential).where(Credential.owner==owner,Credential.platform==data.platform))
        if c: db.delete(c);db.commit()
    return {'ok':True}

@app.post('/api/connections/refresh')
def refresh_connection(data:PlatformInput,owner=Depends(auth)):
    with Session() as db:
        c=db.scalar(select(Credential).where(Credential.owner==owner,Credential.platform==data.platform))
        if not c or not can_refresh(c): raise HTTPException(400,'Bu bağlantı otomatik yenilenemiyor. Yeniden bağlan seçeneğini kullan.')
        identifier=c.id
    refresh_credential(identifier,True);return {'ok':True}

class OAuthInput(BaseModel): platform:Platform;account:str=Field(default='',max_length=100)
@app.post('/api/oauth/start')
def start_oauth(data:OAuthInput,req:Request,owner=Depends(auth)):
    with Session() as db: return {'url':begin(db,data.platform,owner,req.cookies['akis_session'],data.account)}

class AppInput(BaseModel):
    platform:Platform
    client_id:str=Field(min_length=1,max_length=250)
    client_secret:str=Field(default='',max_length=4000)
    redirect_uri:str=Field(max_length=600)
    mode:Literal['web','desktop']='web'

@app.post('/api/settings/oauth')
def save_app(data:AppInput,owner=Depends(auth)):
    uri=urlsplit(data.redirect_uri)
    if uri.query or uri.fragment or uri.username or uri.password or uri.path!=f'/api/oauth/{data.platform}/callback': raise HTTPException(400,'Dönüş adresi /api/oauth/'+data.platform+'/callback ile bitmeli; sorgu veya kullanıcı bilgisi içermemeli.')
    if uri.scheme!='https' and not(uri.scheme=='http' and uri.hostname in ('localhost','127.0.0.1')): raise HTTPException(400,'HTTPS adresi veya yerel geliştirme adresi kullan.')
    if data.platform=='tiktok':
        if data.mode=='web' and (uri.scheme!='https' or uri.hostname in ('localhost','127.0.0.1')): raise HTTPException(400,'TikTok Web için herkese açık HTTPS dönüş adresi gerekir. Yerel uygulama için Desktop modunu seç.')
        if data.mode=='desktop' and (uri.hostname not in ('localhost','127.0.0.1') or not uri.port): raise HTTPException(400,'TikTok Desktop için port içeren localhost veya 127.0.0.1 dönüş adresi kullan.')
    with Session() as db:
        a=db.get(OAuthApp,data.platform)
        if not a: a=OAuthApp(platform=data.platform,client_id=data.client_id,redirect_uri=data.redirect_uri);db.add(a)
        if not data.client_secret and not a.client_secret and data.platform!='x': raise HTTPException(400,'Uygulama gizli anahtarını gir.')
        a.client_id=data.client_id;a.redirect_uri=data.redirect_uri;a.mode=data.mode
        if data.client_secret: a.client_secret=encrypt(data.client_secret)
        db.commit()
    return {'ok':True}

class PublicInput(BaseModel): public_base_url:str=Field(max_length=500)
@app.post('/api/settings/public')
def save_public(data:PublicInput,owner=Depends(auth)):
    value=data.public_base_url.rstrip('/')
    if value:
        u=urlsplit(value)
        if u.scheme!='https' or not u.hostname or u.path or u.query or u.fragment or u.username or u.password: raise HTTPException(400,'Yalnızca HTTPS alan adını gir. Örnek: https://akis.ornek.com')
    with Session() as db:
        row=db.get(AppSetting,'public_base_url')
        if not row: row=AppSetting(key='public_base_url',value=value);db.add(row)
        else: row.value=value
        db.commit()
    return {'ok':True}

@app.post('/api/media',status_code=202)
async def upload(file:UploadFile=File(...),owner=Depends(auth)):
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
            header=path.read_bytes()[:32] if size<32 else None
            if header is None:
                with path.open('rb') as f: header=f.read(32)
            if header[4:8]!=b'ftyp' and not header.startswith(b'\x1aE\xdf\xa3'): raise HTTPException(400,'JPEG, PNG, WebP, HEIC, MP4, MOV veya WebM dosyası yükle.')
            mime='video/mp4'
        with Session() as db:
            a=MediaAsset(id=identifier,owner=owner,filename=Path(file.filename or 'medya').name[:240],storage_key=path.name,mime_type=mime,size=size,status='processing');db.add(a);db.commit();result=asset_json(a,db)
        return result
    except Exception:
        path.unlink(missing_ok=True);raise
    finally: await file.close()

@app.get('/api/media/{identifier}')
def get_asset(identifier:str,owner=Depends(auth)):
    with Session() as db:
        a=db.get(MediaAsset,identifier)
        if not a or a.owner!=owner: raise HTTPException(404,'Medya bulunamadı.')
        return asset_json(a,db)

@app.get('/api/media/{identifier}/file')
def serve_media(identifier:str,req:Request,expires:int=0,signature:str=''):
    signed=now()<expires<=now()+86400*3 and hmac.compare_digest(signature,sign(f'{identifier}:{expires}'))
    if not signed and not valid_session(req.cookies.get('akis_session','')): raise HTTPException(403,'Medya bağlantısının süresi dolmuş veya erişim izni yok.')
    with Session() as db:
        a=db.get(MediaAsset,identifier)
        if not a or a.status!='ready' or (not signed and a.owner!=OWNER): raise HTTPException(404,'Medya bulunamadı.')
        return FileResponse(path_for(a.storage_key),media_type=a.mime_type,headers={'Cache-Control':'private, max-age=300','Content-Disposition':'inline'})

class ContentInput(BaseModel):
    requestId:UUID
    text:str=Field(default='',max_length=5000)
    platforms:list[Platform]=Field(min_length=1,max_length=4)
    asset_id:str|None=None
    send:bool=False
    recipients:list[str]=Field(default_factory=list,max_length=100)
    template:str=Field(default='',max_length=150)
    language:str=Field(default='tr',max_length=12)
    template_params:list[str]=Field(default_factory=list,max_length=20)
    wa_mode:Literal['template','session']='template'
    session_confirmed:bool=False

@app.post('/api/posts',status_code=202)
def create_content(data:ContentInput,background:BackgroundTasks,owner=Depends(auth)):
    identifier=str(data.requestId);options={k:getattr(data,k) for k in ('recipients','template','language','template_params','wa_mode','session_confirmed')}
    fingerprint=hashlib.sha256(json.dumps(data.model_dump(mode='json',exclude={'requestId'}),sort_keys=True).encode()).hexdigest()
    with Session() as db:
        existing=db.get(Content,identifier)
        if existing:
            if existing.created_by!=owner or existing.fingerprint!=fingerprint: raise HTTPException(409,'Bu istek daha önce farklı içerikle kaydedilmiş. Gönderiler ekranını kontrol et.')
            return {'id':identifier,'alreadySaved':True}
        asset=db.get(MediaAsset,data.asset_id) if data.asset_id else None
        if data.asset_id and (not asset or asset.owner!=owner): raise HTTPException(400,'Seçilen medya bulunamadı.')
        if not data.text.strip() and not asset and not data.template: raise HTTPException(400,'Metin, medya veya mesaj şablonu ekle.')
        platforms=list(dict.fromkeys(data.platforms));recipients=list(dict.fromkeys(data.recipients))
        if data.send:
            if asset and asset.status=='failed': raise HTTPException(400,asset.error or 'Medya hazırlanamadı.')
            if 'x' in platforms and len(data.text)>280: raise HTTPException(400,'X metnini 280 karakterin altına indir.')
            if 'instagram' in platforms and len(data.text)>2200: raise HTTPException(400,'Instagram açıklaması en fazla 2200 karakter olabilir.')
            if any(p in platforms for p in ('instagram','tiktok')) and not asset: raise HTTPException(400,'Instagram ve TikTok için bir dosya yükle.')
            if 'whatsapp' in platforms:
                if not recipients or any(not re.fullmatch(r'\d{8,15}',r) for r in recipients): raise HTTPException(400,'WhatsApp alıcılarını ülke koduyla, yalnızca rakam kullanarak gir.')
                if data.wa_mode=='template' and (not re.fullmatch(r'\w+',data.template) or not re.fullmatch(r'\w{2,12}',data.language)): raise HTTPException(400,'Şablon adını ve onaylı dil kodunu gir.')
                if data.wa_mode=='session' and not data.session_confirmed: raise HTTPException(400,'Serbest mesaj için alıcının son 24 saat içinde mesaj gönderdiğini doğrula veya şablon kullan.')
            connected={c.platform for c in db.scalars(select(Credential).where(Credential.owner==owner))}
            if any(p not in connected for p in platforms): raise HTTPException(400,'Önce seçilen hesapları Bağlantılar ekranından bağla.')
        p=Content(id=identifier,created_by=owner,body_text=data.text.strip(),platforms=platforms,asset_id=data.asset_id,options=options,status='processing' if data.send else 'draft',fingerprint=fingerprint)
        db.add(p);db.flush()
        if asset and not asset.content_id: asset.content_id=identifier
        if data.send:
            for platform in platforms:
                for recipient in recipients if platform=='whatsapp' else ['']:
                    db.add(ContentPlatform(content_id=identifier,platform=platform,recipient=recipient,status='pending'))
            if 'whatsapp' in platforms: db.add(Broadcast(content_id=identifier,template_id=data.template,recipient_list=recipients))
        try: db.commit()
        except IntegrityError:
            db.rollback();old=db.get(Content,identifier)
            if old and old.created_by==owner and old.fingerprint==fingerprint: return {'id':identifier,'alreadySaved':True}
            raise HTTPException(409,'İstek kaydedilemedi. Gönderiler ekranını kontrol et.')
    if data.send:
        from .jobs import enqueue_content
        background.add_task(enqueue_content,identifier)
    # The response is immediate; Beat also recovers the durable outbox after broker interruptions.
    return {'id':identifier,'queued':data.send}

class RetryInput(BaseModel): delivery_id:str
@app.post('/api/retry')
def retry(data:RetryInput,owner=Depends(auth)):
    with Session() as db:
        row=db.get(ContentPlatform,data.delivery_id);p=db.get(Content,row.content_id) if row else None
        if not row or not p or p.created_by!=owner: raise HTTPException(404,'Gönderi bulunamadı.')
        if row.status!='failed': raise HTTPException(400,'Yalnızca kesin başarısız gönderimler yeniden denenebilir.')
        changed=db.execute(update(ContentPlatform).where(ContentPlatform.id==row.id,ContentPlatform.status=='failed').values(status='pending',next_attempt_at=now(),retry_count=0,error_code=None,error_message=None,final_request_started=False)).rowcount
        p.status='processing';db.commit();return {'ok':bool(changed)}
