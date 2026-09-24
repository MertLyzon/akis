import threading
from contextlib import contextmanager
from sqlalchemy import select
from .db import Session
from .models import Credential,OAuthApp,now
from .security import encrypt,decrypt
from .config import settings
from .platform_http import request
from .errors import PlatformError

_locks={}
_guard=threading.Lock()
@contextmanager
def asset_lock(key):
    if settings.queue_mode=='celery':
        import redis
        with redis.Redis.from_url(settings.redis_url).lock('akis:lock:'+key,timeout=600,blocking_timeout=450): yield
    else:
        with _guard: lock=_locks.setdefault(key,threading.RLock())
        with lock: yield

def can_refresh(c):
    return bool(c.refresh_token and c.platform in ('x','tiktok')) or (c.platform=='instagram' and c.token_kind=='long_lived')

def refresh_credential(credential_id,force=False):
    with asset_lock('credential:'+credential_id),Session() as db:
        c=db.scalar(select(Credential).where(Credential.id==credential_id).with_for_update())
        if not c: raise PlatformError('auth','missing','Hesap bağlantısı bulunamadı.')
        threshold=7*86400 if c.platform=='instagram' else 600
        if not force and (not c.expires_at or c.expires_at>now()+threshold): return decrypt(c.access_token)
        if not can_refresh(c):
            if c.expires_at and c.expires_at<=now(): raise PlatformError(c.platform,'401')
            return decrypt(c.access_token)
        if c.refresh_expires_at and c.refresh_expires_at<=now(): raise PlatformError(c.platform,'invalid_grant')
        app=db.get(OAuthApp,(c.company_id,c.platform))
        try:
            if c.platform=='instagram':
                if c.updated_at>now()-86400: return decrypt(c.access_token)
                data=request('instagram','GET','https://graph.instagram.com/refresh_access_token',params={'grant_type':'ig_refresh_token','access_token':decrypt(c.access_token)})
            else:
                if not app: raise PlatformError(c.platform,'app_missing','Otomatik yenileme için Ayarlar bölümüne uygulama bilgilerini ekle.')
                body={'grant_type':'refresh_token','refresh_token':decrypt(c.refresh_token)}
                if c.platform=='x':
                    body['client_id']=app.client_id
                    kwargs={'auth':(app.client_id,decrypt(app.client_secret))} if app.client_secret else {}
                    data=request('x','POST','https://api.x.com/2/oauth2/token',data=body,**kwargs)
                else:
                    body.update(client_key=app.client_id,client_secret=decrypt(app.client_secret))
                    data=request('tiktok','POST','https://open.tiktokapis.com/v2/oauth/token/',data=body)
            if not data.get('access_token'): raise PlatformError(c.platform,'invalid_token')
            c.access_token=encrypt(data['access_token']);c.updated_at=now();c.refresh_error=None
            c.expires_at=now()+int(data['expires_in']) if data.get('expires_in') else None
            if data.get('refresh_token'): c.refresh_token=encrypt(data['refresh_token'])
            if data.get('refresh_expires_in'): c.refresh_expires_at=now()+int(data['refresh_expires_in'])
            db.commit();return data['access_token']
        except PlatformError as exc:
            c.refresh_error=exc.message;db.commit();raise

def token_for(company_id,platform):
    with Session() as db:
        c=db.scalar(select(Credential).where(Credential.company_id==company_id,Credential.platform==platform))
        if not c: raise PlatformError(platform,'missing','Bu hesap bağlı değil. Bağlantılar bölümünden hesabı bağla.')
        identifier=c.id
    return refresh_credential(identifier)

def refresh_due():
    with Session() as db:
        ids=[c.id for c in db.scalars(select(Credential)) if can_refresh(c) and c.expires_at and c.expires_at<now()+(7*86400 if c.platform=='instagram' else 600)]
    for identifier in ids:
        try: refresh_credential(identifier)
        except PlatformError: pass
