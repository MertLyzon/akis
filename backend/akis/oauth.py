import base64, hashlib, html, json, secrets
from urllib.parse import urlencode, urlsplit
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy import select,update
from .db import Session
from .models import OAuthApp,OAuthState,Credential,Membership,User,now
from .security import encrypt,decrypt,read_session
from .access import PERMISSIONS,audit,Actor
from .platform_http import request as platform_request
from .errors import PlatformError
from .config import settings

router=APIRouter()
SCOPES={'x':'tweet.read tweet.write users.read offline.access media.write','tiktok':'user.info.basic,video.upload','instagram':'instagram_business_basic,instagram_business_content_publish','whatsapp':'whatsapp_business_management,whatsapp_business_messaging'}

def begin(db,platform,actor,session,account_id=''):
    app=db.get(OAuthApp,(actor.company_id,platform))
    if not app: raise HTTPException(400,'Önce Ayarlar bölümüne bu platformun uygulama bilgilerini ekle.')
    if platform=='whatsapp' and not account_id.isdigit(): raise HTTPException(400,'Yeniden bağlanmadan önce WhatsApp telefon numarası ID alanını doldur.')
    verifier=secrets.token_urlsafe(64);state=secrets.token_urlsafe(32)
    db.add(OAuthState(id=state,company_id=actor.company_id,user_id=actor.user_id,session_hash=hashlib.sha256(session.encode()).hexdigest(),platform=platform,verifier=encrypt(json.dumps({'verifier':verifier,'account_id':account_id,'redirect_uri':app.redirect_uri})),expires_at=now()+600))
    db.commit()
    params={'redirect_uri':app.redirect_uri,'state':state,'response_type':'code','scope':SCOPES[platform]}
    if platform=='x':
        params.update(client_id=app.client_id,code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='),code_challenge_method='S256')
        endpoint='https://x.com/i/oauth2/authorize'
    elif platform=='tiktok':
        params['client_key']=app.client_id
        if app.mode=='desktop': params.update(code_challenge=hashlib.sha256(verifier.encode()).hexdigest(),code_challenge_method='S256')
        endpoint='https://www.tiktok.com/v2/auth/authorize/'
    elif platform=='instagram':
        params.update(client_id=app.client_id,enable_fb_login='0',force_authentication='1');endpoint='https://www.instagram.com/oauth/authorize'
    else:
        params.update(client_id=app.client_id,auth_type='rerequest');endpoint=f'https://www.facebook.com/{settings.graph_version}/dialog/oauth'
    return endpoint+'?'+urlencode(params)

def exchange(platform,app,code,details):
    body={'grant_type':'authorization_code','code':code,'redirect_uri':details['redirect_uri']}
    if platform=='x':
        body.update(client_id=app.client_id,code_verifier=details['verifier'])
        extra={'auth':(app.client_id,decrypt(app.client_secret))} if app.client_secret else {}
        data=platform_request(platform,'POST','https://api.x.com/2/oauth2/token',data=body,**extra)
        profile=platform_request(platform,'GET','https://api.x.com/2/users/me',data.get('access_token'))
        account=profile.get('data',{});return data,str(account.get('id','')),account.get('username','X hesabı'),'oauth'
    if platform=='tiktok':
        body.update(client_key=app.client_id,client_secret=decrypt(app.client_secret))
        if app.mode=='desktop': body['code_verifier']=details['verifier']
        data=platform_request(platform,'POST','https://open.tiktokapis.com/v2/oauth/token/',data=body)
        return data,data.get('open_id',''),'TikTok hesabı','oauth'
    if platform=='instagram':
        body.update(client_id=app.client_id,client_secret=decrypt(app.client_secret))
        data=platform_request(platform,'POST','https://api.instagram.com/oauth/access_token',data=body)
        data=data.get('data',[data])[0] if isinstance(data.get('data'),list) else data
        long=platform_request(platform,'GET','https://graph.instagram.com/access_token',params={'grant_type':'ig_exchange_token','client_secret':decrypt(app.client_secret),'access_token':data.get('access_token','')})
        profile=platform_request(platform,'GET',f'https://graph.instagram.com/{settings.graph_version}/me',long.get('access_token'),params={'fields':'user_id,username'})
        return long,str(profile.get('user_id') or data.get('user_id') or profile.get('id','')),profile.get('username','Instagram hesabı'),'long_lived'
    data=platform_request(platform,'GET',f'https://graph.facebook.com/{settings.graph_version}/oauth/access_token',params={'client_id':app.client_id,'client_secret':decrypt(app.client_secret),'redirect_uri':details['redirect_uri'],'code':code})
    # Confirm this token can access the intended phone number before replacing a connection.
    profile=platform_request(platform,'GET',f'https://graph.facebook.com/{settings.graph_version}/{details["account_id"]}',data.get('access_token'),params={'fields':'id,display_phone_number,verified_name'})
    return data,str(profile['id']),profile.get('verified_name') or profile.get('display_phone_number','WhatsApp hesabı'),'oauth'

@router.get('/api/oauth/{platform}/callback')
def callback(platform:str,req:Request):
    ok=False;message='Bağlantı doğrulanamadı. Bağlantılar ekranından tekrar dene.'
    try:
        session=req.cookies.get('akis_session','');state=req.query_params.get('state','')
        parsed=read_session(session)
        if not parsed: raise HTTPException(401,'Oturumun süresi doldu. Akış’a yeniden giriş yap.')
        with Session() as db:
            row=db.get(OAuthState,state)
            if not row or row.platform!=platform or row.expires_at<now() or row.used or row.session_hash!=hashlib.sha256(session.encode()).hexdigest() or row.user_id!=parsed[0]: raise HTTPException(400,'Bağlantı isteğinin süresi dolmuş veya daha önce kullanılmış.')
            member=db.scalar(select(Membership).where(Membership.company_id==row.company_id,Membership.user_id==row.user_id))
            if not member or 'connections' not in PERMISSIONS[member.role]: raise HTTPException(403,'Hesap bağlama yetkin yok.')
            changed=db.execute(update(OAuthState).where(OAuthState.id==state,OAuthState.used==False).values(used=True)).rowcount;db.commit()
            if not changed: raise HTTPException(400,'Bağlantı isteği daha önce kullanılmış.')
            if req.query_params.get('error'): raise HTTPException(400,'Hesap bağlama onayı tamamlanmadı.')
            code=req.query_params.get('code','')
            if not code: raise HTTPException(400,'Platform bağlantı kodu döndürmedi.')
            app=db.get(OAuthApp,(row.company_id,platform));details=json.loads(decrypt(row.verifier))
            if not app or app.redirect_uri!=details['redirect_uri']: raise HTTPException(400,'Uygulama ayarları değişti; bağlantıyı yeniden başlat.')
            data,account,label,kind=exchange(platform,app,code,details)
            if not data.get('access_token') or not account: raise HTTPException(400,'Platform hesap bilgisini döndürmedi.')
            c=db.scalar(select(Credential).where(Credential.company_id==row.company_id,Credential.platform==platform))
            if not c: c=Credential(company_id=row.company_id,platform=platform,access_token='');db.add(c)
            c.connected_by=row.user_id
            c.access_token=encrypt(data['access_token']);c.refresh_token=encrypt(data.get('refresh_token'));c.account_id=account;c.account_label=label
            c.expires_at=now()+int(data['expires_in']) if data.get('expires_in') else None
            c.refresh_expires_at=now()+int(data['refresh_expires_in']) if data.get('refresh_expires_in') else None
            c.updated_at=now();c.refresh_error=None;c.token_kind=kind;c.scopes=data.get('scope',SCOPES[platform])
            user=db.get(User,row.user_id)
            audit(db,Actor(row.user_id,user.email if user else '',False,row.company_id),'connection.oauth','credential',c.platform,account=label);db.commit()
            ok=True;message='Hesabın bağlandı. Bu pencereyi kapatabilirsin.'
    except HTTPException as exc: message=str(exc.detail)
    except PlatformError as exc: message=exc.message
    except Exception: message='Hesap bağlanamadı. Uygulama bilgilerini ve kayıtlı dönüş adresini kontrol et.'
    event=json.dumps({'type':'akis-oauth','ok':ok,'message':message}).replace('<','\\u003c')
    origin=json.dumps(settings.app_origin)
    return HTMLResponse(f'<!doctype html><html lang="tr"><meta charset="utf-8"><title>Akış bağlantı</title><body style="font:16px system-ui;padding:40px"><h1>Akış</h1><p>{html.escape(message)}</p><a href="/">Akış’a dön</a><script>if(window.opener){{window.opener.postMessage({event},{origin});}}{ "window.close();" if ok else "" }</script></body></html>',headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})
