"""Dynamic security checks: company isolation matrix, CSRF/CORS, 2FA races, OAuth edge cases,
uploads, remote media fetches, ETag isolation, queue races, audit and backup integrity."""
import base64,gzip,io,json,threading,time,uuid
from contextlib import contextmanager
from urllib.parse import parse_qs,urlsplit
import httpx,pytest
from PIL import Image
from sqlalchemy import select,func
from akis.db import Session
from akis.models import (AuditLog,Company,Content,ContentPlatform,Credential,DeliveryAttempt,MediaAsset,Membership,OAuthState,User,now)
from akis.media import process_asset,path_for
from akis.security import totp_code,encrypt,decrypt
from test_companies import add_member,accept_invite,user_client,ORIGIN

def png(name='a.png',size=(40,40)):
    out=io.BytesIO();Image.new('RGB',size,'red').save(out,'PNG');return {'file':(name,out.getvalue(),'image/png')}

@contextmanager
def anon():
    from fastapi.testclient import TestClient
    from akis.main import app
    with TestClient(app,base_url='http://localhost:5173',headers=ORIGIN) as c:
        c.post('/api/logout');c.cookies.clear();yield c

def a_company():
    with Session() as db: return db.scalar(select(Company.id).order_by(Company.created_at))

# ---------------- Two companies, every role ----------------

@pytest.fixture
def world(client):
    """Company A (the bootstrap company, system admin is its admin) with real resources,
    company B with one user per role. Returns ids and a factory for logged-in B clients."""
    cid_a=a_company()
    client.post('/api/connections',json={'platform':'x','token':'A-SECRET-TOKEN'})
    asset=client.post('/api/media',files=png()).json()['id'];process_asset(asset)
    draft=client.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':'A draft','platforms':['x']}).json()['id']
    sent=client.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':'A sent','platforms':['x'],'send':True}).json()['id']
    with Session() as db:
        delivery=db.scalar(select(ContentPlatform.id).where(ContentPlatform.content_id==sent))
        db.get(ContentPlatform,delivery).status='failed';db.commit()
    a_member_pw=add_member(client,'a-editor@a.com','editor')
    with Session() as db: a_member=db.scalar(select(User.id).where(User.email=='a-editor@a.com'))
    r=client.post('/api/system/companies',json={'name':'B Ltd','admin_email':'b-admin@b.com'}).json()
    cid_b=r['id'];b_pw={'admin':r['temporary_password']}
    with user_client('b-admin@b.com',b_pw['admin']) as b:
        b.headers['X-Akis-Company']=cid_b
        for role in ('approver','editor','viewer'):
            b_pw[role]=f'b-{role}-parola-123'
            token=b.post('/api/company/members',json={'email':f'b-{role}@b.com','role':role}).json()['invite_token']
            assert accept_invite(token,b_pw[role]).status_code==200
    b_pw['admin']+='-kalici'  # the system admin's temporary password was replaced by user_client
    return dict(cid_a=cid_a,cid_b=cid_b,asset=asset,draft=draft,sent=sent,delivery=delivery,a_member=a_member,a_member_pw=a_member_pw,b_pw=b_pw)

def attacks(w):
    A=w
    return [
        ('GET',f"/api/media/{A['asset']}",None),('GET',f"/api/media/{A['asset']}/file",None),
        ('PATCH',f"/api/media/{A['asset']}",{'folder':'pwned'}),('DELETE',f"/api/media/{A['asset']}",None),
        ('PUT',f"/api/posts/{A['draft']}",{'text':'pwned','platforms':['x']}),('DELETE',f"/api/posts/{A['draft']}",None),
        ('POST',f"/api/posts/{A['sent']}/approve",{}),('POST',f"/api/posts/{A['sent']}/reject",{'note':'x'}),('POST',f"/api/posts/{A['sent']}/cancel",{}),
        ('POST','/api/retry',{'delivery_id':A['delivery']}),
        ('PATCH',f"/api/company/members/{A['a_member']}",{'role':'admin'}),('DELETE',f"/api/company/members/{A['a_member']}",None),
        ('POST',f"/api/company/members/{A['a_member']}/reset-password",{}),
        ('PATCH',f"/api/system/companies/{A['cid_a']}",{'disabled':True}),('POST','/api/system/backup',{}),
        ('GET','/api/system/overview',None),('POST','/api/settings/public',{'public_base_url':'https://evil.example'}),
    ]

@pytest.mark.parametrize('role',['admin','approver','editor','viewer'])
def test_company_b_cannot_touch_company_a(world,role):
    w=world
    with user_client(f'b-{role}@b.com',w['b_pw'][role]) as b:
        for forged in (w['cid_b'],w['cid_a']):
            b.headers['X-Akis-Company']=forged
            for method,path,body in attacks(w):
                r=b.request(method,path,json=body)
                assert r.status_code in (401,403,404),(role,forged==w['cid_a'],method,path,r.status_code,r.text)
            # Company-scoped reads with a forged company header are refused outright.
            if forged==w['cid_a']:
                for path in ('/api/state','/api/media','/api/audit','/api/company'):
                    assert b.get(path).status_code==403,path
                for method,path,body in [('POST','/api/connections',{'platform':'x','token':'t'}),('DELETE','/api/connections',{'platform':'x'}),('POST','/api/oauth/start',{'platform':'x'}),('POST','/api/settings/oauth',{'platform':'x','client_id':'c','redirect_uri':'http://localhost:5173/api/oauth/x/callback'}),('PATCH','/api/company',{'name':'pwned'}),('POST','/api/company/members',{'email':'x@x.com'}),('POST','/api/media',None)]:
                    r=b.request(method,path,json=body) if body else b.post(path,files=png())
                    assert r.status_code==403,(method,path,r.status_code)
        # Using A's asset inside B's own content is refused.
        b.headers['X-Akis-Company']=w['cid_b']
        if role!='viewer':
            r=b.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':'x','platforms':['x'],'asset_id':w['asset']})
            assert r.status_code==400
        # B's state never lists A's data.
        s=b.get('/api/state').text
        for secret in ('A draft','A sent','A-SECRET-TOKEN',w['asset']): assert secret not in s
    with Session() as db:
        assert db.get(Content,w['draft']).body_text=='A draft'
        assert db.get(MediaAsset,w['asset']).folder==''
        assert db.get(ContentPlatform,w['delivery']).status=='failed'
        assert db.scalar(select(Membership.role).where(Membership.user_id==w['a_member']))=='editor'
        assert not db.get(Company,w['cid_a']).disabled
        assert db.scalar(select(func.count()).select_from(Credential).where(Credential.company_id==w['cid_a']))==1

def test_system_admin_without_membership_cannot_read_company_content(world,client):
    client.headers['X-Akis-Company']=world['cid_b']
    assert client.get('/api/state').status_code==403
    assert client.get('/api/media').status_code==403
    client.headers.pop('X-Akis-Company')

# ---------------- CSRF / CORS / origin ----------------

def write_routes():
    from akis.main import app
    for path,ops in app.openapi()['paths'].items():
        for method in ops:
            if method.upper() in ('POST','PUT','PATCH','DELETE'):
                yield method.upper(),path.replace('{identifier}','x').replace('{user_id}','x').replace('{company_id}','x').replace('{name}','akis-20260101-000000.json.gz')

@pytest.mark.parametrize('origin',[None,'null','https://evil.example','http://localhost:5173.evil.example','http://127.0.0.1:5173'])
def test_every_cookie_write_endpoint_rejects_foreign_origin(client,origin):
    routes=list(write_routes());assert len(routes)>=30
    with Session() as db: before=db.scalar(select(func.count()).select_from(AuditLog))
    for method,path in routes:
        headers={'Origin':origin} if origin else {}
        if origin is None: client.headers.pop('Origin',None)
        r=client.request(method,path,json={},headers=headers)
        client.headers['Origin']='http://localhost:5173'
        assert r.status_code==403,(origin,method,path,r.status_code)
    with Session() as db: assert db.scalar(select(func.count()).select_from(AuditLog))==before

def test_cors_never_combines_credentials_with_foreign_origins(client):
    evil=client.options('/api/state',headers={'Origin':'https://evil.example','Access-Control-Request-Method':'GET'})
    assert 'access-control-allow-origin' not in evil.headers
    app_origin=client.options('/api/state',headers={'Origin':'tauri://localhost','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'})
    assert app_origin.headers.get('access-control-allow-origin')=='tauri://localhost'
    assert app_origin.headers.get('access-control-allow-credentials')!='true'
    assert client.get('/api/health',headers={'Origin':'https://evil.example'}).headers.get('access-control-allow-origin') is None

def test_app_token_and_web_cookie_do_not_mix(client):
    password=add_member(client,'mix@firma.com','viewer')
    with anon() as c:
        r=c.post('/api/login',json={'email':'mix@firma.com','password':password},headers={'X-Akis-Client':'app'})
        assert r.status_code==200 and r.json()['token'] and 'akis_session' not in r.headers.get('set-cookie','')
        web=c.post('/api/login',json={'email':'mix@firma.com','password':password})
        assert 'token' not in web.json() and 'akis_session' in web.headers['set-cookie']

def test_get_endpoints_do_not_change_state(world,client):
    def snapshot():
        with Session() as db: return [db.scalar(select(func.count()).select_from(t)) for t in (AuditLog,Content,ContentPlatform,MediaAsset,Credential,Membership,OAuthState)]
    before=snapshot()
    for path in ('/api/health','/api/session','/api/state','/api/media',f"/api/media/{world['asset']}",f"/api/media/{world['asset']}/file",'/api/company','/api/audit','/api/system/overview'):
        assert client.get(path).status_code<500,path
    assert snapshot()==before

# ---------------- 2FA ----------------

def enable_2fa(client,email):
    password=add_member(client,email,'editor')
    with user_client(email,password) as c:
        secret=c.post('/api/me/2fa/setup').json()['secret']
        assert c.post('/api/me/2fa/enable',json={'code':totp_code(secret,int(time.time()//30))}).status_code==200
    return password,secret

def test_same_totp_code_in_parallel_logs_in_once(client,monkeypatch):
    password,secret=enable_2fa(client,'yaris@firma.com')
    import akis.main as main
    real=main.totp_match
    def slow(*a,**k):
        r=real(*a,**k);time.sleep(0.4);return r  # both requests read the old counter before either commits
    monkeypatch.setattr(main,'totp_match',slow)
    code=totp_code(secret,int(time.time()//30)+1);results=[]
    def attempt():
        with anon() as c: results.append(c.post('/api/login',json={'email':'yaris@firma.com','password':password,'code':code}).status_code)
    threads=[threading.Thread(target=attempt) for _ in range(2)]
    [t.start() for t in threads];[t.join() for t in threads]
    assert sorted(results)==[200,401],results

def test_totp_window_and_format(client):
    from akis.security import totp_match
    secret='JBSWY3DPEHPK3PXP';t=1_800_000_000;step=t//30
    assert totp_match(secret,totp_code(secret,step-1),at=t)==step-1
    assert totp_match(secret,totp_code(secret,step+1),at=t)==step+1
    assert totp_match(secret,totp_code(secret,step-2),at=t) is None
    assert totp_match(secret,totp_code(secret,step+2),at=t) is None
    good=totp_code(secret,step,)
    assert totp_match(secret,good[:3]+' '+good[3:],at=t)==step  # pasted with a space
    for bad in ('',None,good[:5],good+'1','abcdef','12345a',good[:3]+'x'+good[3:],'1'*50):
        assert totp_match(secret,bad,at=t) is None,bad

def test_disabling_2fa_needs_password_and_fresh_code(client):
    password,secret=enable_2fa(client,'kapat@firma.com')
    code=totp_code(secret,int(time.time()//30)+1)
    with user_client('kapat@firma.com',password,code) as c:
        assert c.post('/api/me/2fa/disable',json={'password':password,'code':''}).status_code==400
        fresh=totp_code(secret,int(time.time()//30)-1)
        assert c.post('/api/me/2fa/disable',json={'password':'yanlis','code':fresh}).status_code==400
        assert c.post('/api/me/2fa/disable',json={'password':password,'code':code}).status_code==400  # already used at login
        assert c.post('/api/me/2fa/disable',json={'password':password,'code':fresh}).status_code in (200,400)

# ---------------- Sessions ----------------

def test_password_change_revokes_bearer_tokens(client):
    password=add_member(client,'bearer@firma.com','viewer')
    with user_client('bearer@firma.com',password):pass
    with anon() as c:
        token=c.post('/api/login',json={'email':'bearer@firma.com','password':password},headers={'X-Akis-Client':'app'}).json()['token']
        auth={'Authorization':'Bearer '+token,'X-Akis-Client':'app'}
        assert c.get('/api/state',headers=auth).status_code==200
        c.post('/api/me/password',json={'current':password,'new':'yepyeni-parola-1'},headers=auth)
        assert c.get('/api/state',headers=auth).status_code==401

def test_disabled_user_session_stops_working(client):
    password=add_member(client,'kapali@firma.com','viewer')
    with user_client('kapali@firma.com',password) as c:
        with Session() as db: db.scalar(select(User).where(User.email=='kapali@firma.com')).disabled=True;db.commit()
        assert c.get('/api/state').status_code==401
        # Local mode then falls back to its loopback auto sign-in; the disabled account itself is never restored.
        assert (c.get('/api/session').json()['user'] or {}).get('email')!='kapali@firma.com'

def test_session_token_never_echoed(client):
    token=client.cookies.get('akis_session')
    for r in (client.get('/api/state'),client.get('/api/session'),client.post('/api/oauth/start',json={'platform':'x'}),client.get('/api/media/nope')):
        assert token not in r.text

# ---------------- OAuth ----------------

def oauth_state(client,platform='x'):
    client.post('/api/settings/oauth',json={'platform':platform,'client_id':'client','client_secret':'CLIENT-SECRET-XYZ','redirect_uri':f'http://localhost:5173/api/oauth/{platform}/callback'})
    return parse_qs(urlsplit(client.post('/api/oauth/start',json={'platform':platform}).json()['url']).query)['state'][0]

def test_expired_oauth_state_is_refused(client,monkeypatch):
    state=oauth_state(client)
    with Session() as db: db.get(OAuthState,state).expires_at=now()-1;db.commit()
    monkeypatch.setattr('akis.oauth.exchange',lambda *a:({'access_token':'t'},'1','x','oauth'))
    assert 'Hesabın bağlandı' not in client.get('/api/oauth/x/callback',params={'state':state,'code':'c'}).text

def test_oauth_state_of_another_user_is_refused(client,monkeypatch):
    state=oauth_state(client)
    password=add_member(client,'baska@firma.com','admin')
    monkeypatch.setattr('akis.oauth.exchange',lambda *a:({'access_token':'t'},'1','x','oauth'))
    with user_client('baska@firma.com',password) as other:
        assert 'Hesabın bağlandı' not in other.get('/api/oauth/x/callback',params={'state':state,'code':'c'}).text
    with Session() as db: assert db.scalar(select(Credential)) is None

def test_oauth_redirect_uri_must_still_match(client,monkeypatch):
    state=oauth_state(client)
    client.post('/api/settings/oauth',json={'platform':'x','client_id':'client','redirect_uri':'https://baska.example/api/oauth/x/callback'})
    monkeypatch.setattr('akis.oauth.exchange',lambda *a:({'access_token':'t'},'1','x','oauth'))
    assert 'Hesabın bağlandı' not in client.get('/api/oauth/x/callback',params={'state':state,'code':'c'}).text

def mock_http(monkeypatch,handler):
    real=httpx.Client
    monkeypatch.setattr('akis.platform_http.httpx.Client',lambda **k: real(transport=httpx.MockTransport(handler),**{x:y for x,y in k.items() if x!='trust_env'}))

def test_oauth_pkce_verifier_reaches_token_endpoint(client,monkeypatch):
    state=oauth_state(client)
    with Session() as db: verifier=json.loads(decrypt(db.get(OAuthState,state).verifier))['verifier']
    seen={}
    def handler(req):
        if req.url.path.endswith('/oauth2/token'): seen.update(parse_qs(req.content.decode()));return httpx.Response(200,json={'access_token':'AT-SECRET','expires_in':7200})
        return httpx.Response(200,json={'data':{'id':'42','username':'hesap'}})
    mock_http(monkeypatch,handler)
    assert 'Hesabın bağlandı' in client.get('/api/oauth/x/callback',params={'state':state,'code':'CODE-123'}).text
    assert seen['code_verifier']==[verifier] and seen['code']==['CODE-123']

@pytest.mark.parametrize('body',[{'error':'invalid_request','error_description':'bad code CODE-123 CLIENT-SECRET-XYZ'},{'error':{'code':190,'message':'token AT-SECRET expired'}},{'token_type':'bearer'}])
def test_oauth_provider_error_inside_http_200_is_failure(client,monkeypatch,body):
    state=oauth_state(client)
    mock_http(monkeypatch,lambda req: httpx.Response(200,json=body))
    r=client.get('/api/oauth/x/callback',params={'state':state,'code':'CODE-123'})
    assert 'Hesabın bağlandı' not in r.text
    for leak in ('CODE-123','CLIENT-SECRET-XYZ','AT-SECRET'): assert leak not in r.text
    with Session() as db: assert db.scalar(select(Credential)) is None

# ---------------- Uploads ----------------

@pytest.mark.parametrize('name,data',[
    ('foto.jpg',b'<html><script>alert(1)</script></html>'),
    ('foto.jpg',b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    ('shell.php.jpg',b'<?php system($_GET["c"]); ?>'),
    ('bozuk.jpg',b'\xff\xd8\xff\xe0'+b'\x00'*20),
])
def test_disguised_uploads_are_refused(client,name,data):
    r=client.post('/api/media',files={'file':(name,data,'image/jpeg')})
    assert r.status_code==400
    with Session() as db: assert db.scalar(select(func.count()).select_from(MediaAsset))==0

def test_upload_filename_cannot_traverse(client):
    r=client.post('/api/media',files=png('../../../etc/passwd.png'))
    assert r.status_code==202 and r.json()['filename']=='passwd.png'
    with Session() as db: key=db.get(MediaAsset,r.json()['id']).storage_key
    assert '/' not in key and '\\' not in key and '..' not in key and path_for(key).exists()

def test_upload_size_limits_and_no_leftovers(client,monkeypatch):
    from akis.config import settings
    from pathlib import Path
    monkeypatch.setattr(settings,'max_upload_mb',1)
    assert client.post('/api/media',files={'file':('bos.png',b'','image/png')}).status_code==400
    under=png(size=(300,300));assert client.post('/api/media',files=under).status_code==202
    before=set(Path(settings.media_root).iterdir())
    assert client.post('/api/media',files={'file':('buyuk.mp4',b'\x00'*(1024*1024+10),'video/mp4')}).status_code==413
    assert set(Path(settings.media_root).iterdir())==before

def test_decompression_bomb_is_refused(client):
    out=io.BytesIO();Image.new('1',(7000,7000)).save(out,'PNG')  # 49 MP, a few KB on disk
    assert len(out.getvalue())<200_000
    r=client.post('/api/media',files={'file':('bomba.png',out.getvalue(),'image/png')})
    assert r.status_code==400,r.text

def test_same_file_uploaded_concurrently(client):
    data=png()['file'];ids=[]
    def up():
        with anon() as c:
            c.get('/api/session')  # local-mode auto sign-in
            ids.append(c.post('/api/media',files={'file':data}).json()['id'])
    threads=[threading.Thread(target=up) for _ in range(3)];[t.start() for t in threads];[t.join() for t in threads]
    assert len(set(ids))==3
    for i in ids: process_asset(i)
    with Session() as db: assert {db.get(MediaAsset,i).status for i in ids}=={'ready'}

# ---------------- Remote media (Cloudinary) fetches ----------------

class FakeAsset:
    def __init__(self,url): self.remote_url=url;self.storage_key='missing.jpg'

@pytest.mark.parametrize('url',['http://res.cloudinary.com/demo/image/upload/a.jpg','https://evilcloudinary.com/a.jpg','https://cloudinary.com.evil.example/a.jpg',
    'https://localhost/a.jpg','https://127.0.0.1/a.jpg','https://10.0.0.5/a.jpg','https://169.254.169.254/latest','file:///etc/passwd','https://res.cloudinary.com@evil.example/a.jpg'])
def test_remote_media_fetch_refuses_foreign_hosts(url,monkeypatch):
    from akis import storage
    monkeypatch.setattr('akis.storage.httpx.stream',lambda *a,**k: (_ for _ in ()).throw(AssertionError('no request may be sent')))
    with pytest.raises(FileNotFoundError):
        with storage.local_file(FakeAsset(url)): pass

def test_remote_media_fetch_does_not_follow_redirects(monkeypatch):
    from akis import storage
    real=httpx.stream
    calls=[]
    def handler(req):
        calls.append(str(req.url))
        return httpx.Response(302,headers={'Location':'http://169.254.169.254/latest/meta-data'})
    def stream(method,url,**k):
        client=httpx.Client(transport=httpx.MockTransport(handler),follow_redirects=k.pop('follow_redirects',True))
        return client.stream(method,url,**k)
    monkeypatch.setattr('akis.storage.httpx.stream',stream)
    with pytest.raises(Exception):
        with storage.local_file(FakeAsset('https://res.cloudinary.com/demo/image/upload/a.jpg')): pass
    assert all('169.254' not in c for c in calls)

@pytest.mark.parametrize('keep',[True,False])
def test_keep_local_media_modes(client,monkeypatch,keep):
    from akis import storage
    from akis.config import settings
    monkeypatch.setattr(settings,'keep_local_media',keep)
    monkeypatch.setattr(storage,'enabled',lambda: True)
    monkeypatch.setattr(storage,'upload',lambda path,a:(f'https://res.cloudinary.com/demo/image/upload/akis/{a.company_id}/{a.id}.jpg',f'akis/{a.company_id}/{a.id}'))
    asset=client.post('/api/media',files=png()).json()['id'];process_asset(asset)
    with Session() as db: a=db.get(MediaAsset,asset);assert a.status=='ready' and a.remote_url.startswith('https://res.cloudinary.com/')
    assert path_for(a.storage_key).exists()==keep
    body=client.get('/api/state').text
    assert 'api_secret' not in body and 'signature' not in body.split(a.remote_url)[0][-50:]

# ---------------- SQL wildcards, injection, error bodies ----------------

@pytest.mark.parametrize('q',["' OR 1=1 --",'%','_','\\','%_\\',"x'); DROP TABLE users; --",'ğüşiöç İ','🙂','\x00'])
def test_search_and_filters_are_inert(client,q):
    client.post('/api/media',files=png('normal.png'))
    for params in ({'q':q},{'folder':q},{'tag':q}):
        r=client.get('/api/media',params=params)
        if '\x00' in q: assert r.status_code==400;continue
        assert r.status_code==200,(params,r.text)
        assert r.json()['items']==[]
    assert client.get('/api/audit',params={'action':q}).status_code==(400 if '\x00' in q else 200)
    from urllib.parse import quote
    for path in (f'/api/media/{quote(q,safe="")}',f'/api/posts/{quote(q,safe="")}'):
        r=client.request('GET' if 'media' in path else 'DELETE',path)
        assert r.status_code in (400,404,405),(path,r.status_code)
    with Session() as db: assert db.scalar(select(func.count()).select_from(User))>=1

def test_unicode_search_matches_literally(client):
    client.post('/api/media',files=png('Şubat_kampanyası.png'))
    assert [a['filename'] for a in client.get('/api/media',params={'q':'Şubat_'}).json()['items']]==['Şubat_kampanyası.png']

def test_nul_characters_are_refused_everywhere(client):
    assert client.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':'a\u0000b','platforms':['x']}).status_code==400
    assert client.patch('/api/company',json={'name':'x\u0000'}).status_code==400
    r=client.post('/api/media',files=png('a\x00b\x07.png'))
    assert r.status_code==202 and r.json()['filename'].isprintable()

def test_error_bodies_have_no_traces(client):
    for r in (client.get('/api/audit',params={'before':'abc'}),client.post('/api/posts',json={'platforms':'x'}),client.put('/api/posts/x',json=None),client.get('/api/media/'+'x'*5000)):
        assert r.status_code<500 and 'Traceback' not in r.text and 'sqlalchemy' not in r.text.lower() and 'SELECT' not in r.text

# ---------------- ETag isolation ----------------

def test_etag_is_bound_to_user_and_company(world,client):
    tag_a=client.get('/api/state').headers['etag']
    with user_client('b-admin@b.com',world['b_pw']['admin']) as b:
        b.headers['X-Akis-Company']=world['cid_b']
        r=b.get('/api/state',headers={'If-None-Match':tag_a})
        assert r.status_code==200 and 'A draft' not in r.text
    r=client.get('/api/state',headers={'If-None-Match':tag_a})
    assert r.status_code==304 and r.content==b'' and r.headers['cache-control']=='no-store'
    client.post('/api/logout');client.cookies.clear()
    r=client.get('/api/state',headers={'If-None-Match':tag_a})
    assert r.status_code==401 and 'A draft' not in r.text

def test_same_data_different_viewers_get_different_etags(client):
    password=add_member(client,'izleyici@firma.com','viewer')
    tag=client.get('/api/state').headers['etag']
    with user_client('izleyici@firma.com',password) as v:
        assert v.get('/api/state',headers={'If-None-Match':tag}).status_code==200

# ---------------- Queue ----------------

def test_parallel_workers_publish_once(job,monkeypatch):
    identifier=job();calls=[]
    def slow(*a,**k): calls.append(1);time.sleep(0.3);return {'data':{'id':'tweet'}}
    monkeypatch.setattr('akis.tasks.x_publisher.request',slow)
    from akis.jobs import run_delivery
    threads=[threading.Thread(target=run_delivery,args=(identifier,)) for _ in range(4)]
    [t.start() for t in threads];[t.join() for t in threads]
    assert len(calls)==1

def test_cancel_refuses_when_worker_already_claimed(client):
    body={'requestId':str(uuid.uuid4()),'text':'Plan','platforms':['x'],'send':True,'scheduled_local':''}
    client.post('/api/connections',json={'platform':'x','token':'t'})
    from datetime import datetime,timedelta
    from zoneinfo import ZoneInfo
    body['scheduled_local']=(datetime.now(ZoneInfo('Europe/Istanbul'))+timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M')
    pid=client.post('/api/posts',json=body).json()['id']
    with Session() as db:
        row=db.scalar(select(ContentPlatform).where(ContentPlatform.content_id==pid));row.status='sending';db.commit()
    assert client.post(f'/api/posts/{pid}/cancel').status_code==400
    with Session() as db: assert db.scalar(select(func.count()).select_from(ContentPlatform).where(ContentPlatform.content_id==pid))==1

# ---------------- Audit ----------------

def test_audit_never_contains_secrets(client):
    client.post('/api/connections',json={'platform':'x','token':'AUDIT-TOKEN-1','refresh_token':'AUDIT-REFRESH-1'})
    client.post('/api/settings/oauth',json={'platform':'tiktok','client_id':'c','client_secret':'AUDIT-CLIENT-SECRET','redirect_uri':'http://localhost:5173/api/oauth/tiktok/callback','mode':'desktop'})
    password=add_member(client,'audit@firma.com','editor')
    with user_client('audit@firma.com',password) as c:
        secret=c.post('/api/me/2fa/setup').json()['secret']
        c.post('/api/me/2fa/enable',json={'code':totp_code(secret,int(time.time()//30))})
    with Session() as db: rows=json.dumps([[r.action,r.details] for r in db.scalars(select(AuditLog))],ensure_ascii=False)
    for leak in ('AUDIT-TOKEN-1','AUDIT-REFRESH-1','AUDIT-CLIENT-SECRET',password,secret): assert leak not in rows
    for action in ('connection.saved','settings.oauth_app','member.invited','member.joined','user.2fa_enabled','user.login'): assert action in rows

def test_audit_pagination_150_entries_same_second(client):
    with Session() as db:
        cid=a_company();stamp=now()-50
        for _ in range(150): db.add(AuditLog(company_id=cid,action='bulk.same',created_at=stamp))
        db.commit()
    seen=[];cursor={}
    while True:
        items=client.get('/api/audit',params={'action':'bulk.','limit':40,**cursor}).json()['items'];seen+=[i['id'] for i in items]
        if len(items)<40: break
        cursor={'before':items[-1]['at'],'before_id':items[-1]['id']}
    assert len(seen)==len(set(seen))==150

# ---------------- Backups ----------------

def test_backup_tampering_and_names(client):
    from akis.backup import backup_dir
    client.post('/api/connections',json={'platform':'x','token':'BACKUP-PLAIN-TOKEN'})
    name=client.post('/api/system/backup').json()['file']
    raw=(backup_dir()/name).read_bytes()
    assert b'BACKUP-PLAIN-TOKEN' not in gzip.decompress(raw)
    for bad in ('../.env','akis-20260101-000000.json.gz/../../x','..%2F..%2Fx','akis-2026.json.gz'):
        assert client.post(f'/api/system/backup/{bad}/verify').status_code in (400,404,405)
    corrupt='akis-20200101-000000.json.gz';(backup_dir()/corrupt).write_bytes(raw[:len(raw)//2])
    r=client.post(f'/api/system/backup/{corrupt}/verify');assert r.status_code==400 and 'Traceback' not in r.text
    notgz='akis-20200101-000001.json.gz';(backup_dir()/notgz).write_bytes(b'not gzip')
    assert client.post(f'/api/system/backup/{notgz}/verify').status_code==400
    data=json.loads(gzip.decompress(raw));data['counts']['contents']=99
    tampered='akis-20200101-000002.json.gz';(backup_dir()/tampered).write_bytes(gzip.compress(json.dumps(data).encode()))
    r=client.post(f'/api/system/backup/{tampered}/verify').json();assert not r['ok'] and 'contents' in r['mismatches']
    assert client.get('/backups/'+name).status_code==404 and client.get('/api/backups/'+name).status_code==404

def test_wrong_credential_key_fails_safely(job,monkeypatch):
    identifier=job()
    from akis.config import settings
    monkeypatch.setattr(settings,'credential_key',base64.b64encode(b'k'*32).decode())
    from akis.jobs import run_delivery
    run_delivery(identifier)
    with Session() as db: row=db.get(ContentPlatform,identifier)
    assert row.status=='failed' and 'fake-token' not in (row.error_message or '')

def test_legacy_import_encrypts_tokens(tmp_path,monkeypatch):
    import sqlite3,importlib.util
    from pathlib import Path
    spec=importlib.util.spec_from_file_location('import_legacy',Path(__file__).resolve().parents[2]/'scripts'/'import_legacy.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    d=tmp_path/'.wrangler/state/v3/d1/x';d.mkdir(parents=True);db=sqlite3.connect(d/'legacy.sqlite')
    db.executescript("create table connections(platform,token,account);create table posts(id,created,status,text,platforms,recipient,template,language,media);create table deliveries(id,post_id,platform,status,error,external_id);")
    db.execute("insert into connections values('x','LEGACY-PLAIN-TOKEN','1')");db.commit();db.close()
    monkeypatch.setattr(mod,'root',tmp_path)
    assert mod.main()==0
    with Session() as s:
        c=s.scalar(select(Credential));assert c.access_token!='LEGACY-PLAIN-TOKEN' and decrypt(c.access_token)=='LEGACY-PLAIN-TOKEN'

def test_cancel_racing_a_worker_claim_on_postgres(client):
    """Real row locks: the worker claims (pending → sending) and holds its transaction while cancel runs."""
    from akis.db import engine
    if engine.dialect.name!='postgresql': pytest.skip('needs PostgreSQL row locking')
    from datetime import datetime,timedelta
    from zoneinfo import ZoneInfo
    from sqlalchemy import update
    client.post('/api/connections',json={'platform':'x','token':'t'})
    when=(datetime.now(ZoneInfo('Europe/Istanbul'))+timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M')
    pid=client.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':'Plan','platforms':['x'],'send':True,'scheduled_local':when}).json()['id']
    claimed=threading.Event();result={}
    def worker():
        with Session() as db:
            db.execute(update(ContentPlatform).where(ContentPlatform.content_id==pid,ContentPlatform.status=='pending').values(status='sending'))
            claimed.set();time.sleep(1.5);db.commit()
    t=threading.Thread(target=worker);t.start();claimed.wait()
    import akis.main as main
    real=main.company_content
    result['status']=client.post(f'/api/posts/{pid}/cancel').status_code
    t.join()
    with Session() as db: rows=list(db.scalars(select(ContentPlatform).where(ContentPlatform.content_id==pid)))
    assert result['status']==400 and len(rows)==1 and rows[0].status=='sending'

def test_small_responses_are_not_gzipped(client):
    r=client.get('/api/health',headers={'Accept-Encoding':'gzip'})
    assert 'content-encoding' not in r.headers and int(r.headers['content-length'])<1024
    for i in range(30): client.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':'Uzun içerik '*30,'platforms':['x']})
    big=client.get('/api/state',headers={'Accept-Encoding':'gzip'})
    assert big.headers['content-encoding']=='gzip' and big.headers['cache-control']=='no-store'
    for h in ('content-security-policy','x-frame-options','x-content-type-options','referrer-policy','permissions-policy'): assert h in big.headers

def test_hsts_only_on_https_origin(client,monkeypatch):
    from akis.config import settings
    assert 'strict-transport-security' not in client.get('/api/health').headers
    monkeypatch.setattr(settings,'app_origin','https://akis.example')
    assert client.get('/api/health').headers['strict-transport-security'].startswith('max-age=31536000')

def test_same_request_id_in_parallel_creates_one_content(client):
    body={'requestId':str(uuid.uuid4()),'text':'Tek sefer','platforms':['x']};codes=[]
    def send():
        with anon() as c:
            c.get('/api/session');codes.append(c.post('/api/posts',json=body).status_code)
    threads=[threading.Thread(target=send) for _ in range(4)];[t.start() for t in threads];[t.join() for t in threads]
    assert set(codes)<={202,409} and 202 in codes
    with Session() as db: assert db.scalar(select(func.count()).select_from(Content).where(Content.id==body['requestId']))==1

def test_interrupted_upload_leaves_no_file(client):
    import asyncio
    from pathlib import Path
    from starlette.requests import ClientDisconnect
    from akis.config import settings
    from akis.access import Actor
    import akis.main as main
    class Broken:
        filename='yarim.mp4';calls=0
        async def read(self,n):
            self.calls+=1
            if self.calls==1: return b'\x00'*1024
            raise ClientDisconnect()
        async def close(self): pass
    before=set(Path(settings.media_root).iterdir())
    with Session() as db: uid=db.scalar(select(User.id))
    with pytest.raises(ClientDisconnect): asyncio.run(main.upload(file=Broken(),actor=Actor(uid,'a@b.c',True,a_company(),'admin')))
    assert set(Path(settings.media_root).iterdir())==before
    with Session() as db: assert db.scalar(select(func.count()).select_from(MediaAsset))==0

# ---------------- Invitations (replaces direct member attach) ----------------

def invite(b,email,role='viewer'):
    t=time.perf_counter();r=b.post('/api/company/members',json={'email':email,'role':role});return r,time.perf_counter()-t

def test_invite_answer_is_identical_for_existing_and_new_emails(world):
    with user_client('b-admin@b.com',world['b_pw']['admin']) as b:
        b.headers['X-Akis-Company']=world['cid_b']
        samples={'existing':[],'new':[]};shapes=set()
        for i in range(30):
            for kind,email in (('existing','a-editor@a.com'),('new',f'yok-{i}@x.com')):
                r,dt=invite(b,email);samples[kind].append(dt)
                body=r.json();shapes.add((r.status_code,tuple(sorted(body)),body['invite_path'].startswith('/#davet=')))
    import statistics
    ex,nw=statistics.median(samples['existing']),statistics.median(samples['new'])
    print(f'invite median existing={ex*1000:.1f}ms new={nw*1000:.1f}ms')
    assert len(shapes)==1 and 0.6<ex/nw<1.6
    with Session() as db:
        # Nobody was attached and no account was created by inviting.
        a_editor=db.scalar(select(User.id).where(User.email=='a-editor@a.com'))
        assert not db.scalar(select(Membership.id).where(Membership.user_id==a_editor,Membership.company_id==world['cid_b']))
        assert not db.scalar(select(User.id).where(User.email.like('yok-%')))

def test_existing_account_joins_only_with_its_own_password(world):
    with user_client('b-admin@b.com',world['b_pw']['admin']) as b:
        b.headers['X-Akis-Company']=world['cid_b']
        token=invite(b,'a-editor@a.com','editor')[0].json()['invite_token']
    assert accept_invite(token,'yanlis-parola-1').status_code==401
    with Session() as db:
        uid=db.scalar(select(User.id).where(User.email=='a-editor@a.com'))
        assert not db.scalar(select(Membership.id).where(Membership.user_id==uid,Membership.company_id==world['cid_b']))
    # The account's own password (chosen when a-editor accepted A's invitation) proves consent.
    assert accept_invite(token,world['a_member_pw']).status_code==200
    with Session() as db:
        assert db.scalar(select(Membership.role).where(Membership.user_id==uid,Membership.company_id==world['cid_b']))=='editor'
        assert db.scalar(select(Membership.role).where(Membership.user_id==uid,Membership.company_id==world['cid_a']))=='editor'

def test_invitation_lifecycle(client):
    r=client.post('/api/company/members',json={'email':'yeni@firma.com','role':'approver','name':'Yeni Kişi'});token=r.json()['invite_token']
    info=client.get(f'/api/invites/{token}').json()
    assert info['email']=='yeni@firma.com' and info['role']=='approver' and 'id' not in info
    assert client.get('/api/company').json()['invites'][0]['email']=='yeni@firma.com'
    assert accept_invite(token,'kisa').status_code==422  # at least 10 characters
    ok=accept_invite(token,'yeni-kisinin-parolasi')
    assert ok.status_code==200 and 'akis_session' in ok.headers['set-cookie']
    with Session() as db:
        u=db.scalar(select(User).where(User.email=='yeni@firma.com'))
        assert u.name=='Yeni Kişi' and not u.must_change_password
        assert db.scalar(select(Membership.role).where(Membership.user_id==u.id))=='approver'
    # Single use.
    assert accept_invite(token,'yeni-kisinin-parolasi').status_code==404
    assert client.get(f'/api/invites/{token}').status_code==404
    assert client.get('/api/company').json()['invites']==[]
    with Session() as db:
        rows=json.dumps([r.details for r in db.scalars(select(AuditLog))])+json.dumps([r.action for r in db.scalars(select(AuditLog))])
    assert token not in rows and 'yeni-kisinin-parolasi' not in rows and 'member.invited' in rows and 'member.joined' in rows

def test_revoked_expired_and_reissued_invitations(client):
    from akis.models import Invitation
    t1=client.post('/api/company/members',json={'email':'iptal@firma.com'}).json()['invite_token']
    t2=client.post('/api/company/members',json={'email':'iptal@firma.com'}).json()['invite_token']
    assert accept_invite(t1,'bir-parola-123').status_code==404  # re-inviting replaces the old link
    iid=client.get('/api/company').json()['invites'][0]['id']
    assert client.delete(f'/api/company/invites/{iid}').status_code==200
    assert accept_invite(t2,'bir-parola-123').status_code==404
    t3=client.post('/api/company/members',json={'email':'sure@firma.com'}).json()['invite_token']
    with Session() as db:
        for i in db.scalars(select(Invitation).where(Invitation.email=='sure@firma.com')): i.expires_at=now()-1
        db.commit()
    assert accept_invite(t3,'bir-parola-123').status_code==404
    with Session() as db: assert not db.scalar(select(User.id).where(User.email.in_(('iptal@firma.com','sure@firma.com'))))

def test_invitation_of_other_company_cannot_be_revoked(world,client):
    iid=None
    with user_client('b-admin@b.com',world['b_pw']['admin']) as b:
        b.headers['X-Akis-Company']=world['cid_b']
        invite(b,'b-yeni@b.com')
        iid=b.get('/api/company').json()['invites'][0]['id']
    assert client.delete(f'/api/company/invites/{iid}').status_code==404
    with user_client('b-editor@b.com',world['b_pw']['editor']) as e:
        e.headers['X-Akis-Company']=world['cid_b']
        assert e.post('/api/company/members',json={'email':'x@x.com'}).status_code==403
        assert e.get('/api/company/invites').status_code==403

def test_accepting_needs_2fa_code_when_enabled(world):
    password,secret=enable_2fa_for('iki@firma.com')
    with user_client('b-admin@b.com',world['b_pw']['admin']) as b:
        b.headers['X-Akis-Company']=world['cid_b']
        token=invite(b,'iki@firma.com')[0].json()['invite_token']
    r=accept_invite(token,password)
    assert r.status_code==401 and r.json()['needs_code']
    assert accept_invite(token,password,code=totp_code(secret,int(time.time()//30)+1)).status_code==200

def enable_2fa_for(email):
    from test_companies import add_member as add
    from fastapi.testclient import TestClient
    from akis.main import app
    with TestClient(app,base_url='http://localhost:5173',headers=ORIGIN) as admin:
        admin.get('/api/session');password=add(admin,email,'viewer')
    with user_client(email,password) as c:
        secret=c.post('/api/me/2fa/setup').json()['secret']
        assert c.post('/api/me/2fa/enable',json={'code':totp_code(secret,int(time.time()//30))}).status_code==200
    return password,secret

def test_invite_acceptance_is_rate_limited(client):
    password=add_member(client,'hedef@firma.com','viewer')
    r=client.post('/api/system/companies',json={'name':'C Ltd','admin_email':'c-admin@c.com'}).json()
    with user_client('c-admin@c.com',r['temporary_password']) as c:
        c.headers['X-Akis-Company']=r['id']
        token=invite(c,'hedef@firma.com')[0].json()['invite_token']
    codes=[accept_invite(token,f'tahmin-parola-{i}').status_code for i in range(7)]
    assert codes[:5]==[401]*5 and set(codes[5:])=={429}
    with Session() as db:
        uid=db.scalar(select(User.id).where(User.email=='hedef@firma.com'))
        assert db.scalar(select(func.count()).select_from(Membership).where(Membership.user_id==uid))==1

def test_same_invitation_accepted_twice_in_parallel(client):
    token=client.post('/api/company/members',json={'email':'paralel@firma.com'}).json()['invite_token'];codes=[]
    threads=[threading.Thread(target=lambda: codes.append(accept_invite(token,'paralel-parola-1').status_code)) for _ in range(3)]
    [t.start() for t in threads];[t.join() for t in threads]
    assert codes.count(200)==1 and set(codes)<={200,404,409}
    with Session() as db: assert db.scalar(select(func.count()).select_from(User).where(User.email=='paralel@firma.com'))==1
