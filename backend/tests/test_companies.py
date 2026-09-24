import io,json,time,uuid
from contextlib import contextmanager
from datetime import datetime
from zoneinfo import ZoneInfo
import pytest
from PIL import Image
from sqlalchemy import select,func
from akis.db import Session
from akis.models import Content,ContentPlatform,DeliveryAttempt,AuditLog,MediaAsset,Credential,now
from akis.security import totp_code
from akis.jobs import run_delivery,dispatch

ORIGIN={'Origin':'http://localhost:5173'}

@contextmanager
def user_client(email,password,code=''):
    from fastapi.testclient import TestClient
    from akis.main import app
    with TestClient(app,base_url='http://localhost:5173',headers=ORIGIN) as c:
        c.post('/api/logout')
        r=c.post('/api/login',json={'email':email,'password':password,'code':code})
        assert r.status_code==200,r.text
        if c.get('/api/session').json()['user']['must_change_password']:
            assert c.get('/api/state').status_code==403  # blocked until the temporary password is replaced
            assert c.post('/api/me/password',json={'current':password,'new':password+'-kalici'}).status_code==200
        yield c

def add_member(client,email,role):
    r=client.post('/api/company/members',json={'email':email,'role':role})
    assert r.status_code==200,r.text
    return r.json()['temporary_password']

def post(client,**extra):
    body={'requestId':str(uuid.uuid4()),'text':'Merhaba dünya','platforms':['x'],'send':True,**extra}
    return client.post('/api/posts',json=body)

def deliveries(content_id):
    with Session() as db: return list(db.scalars(select(ContentPlatform).where(ContentPlatform.content_id==content_id)))

def test_editor_submits_and_approver_publishes(client):
    client.post('/api/connections',json={'platform':'x','token':'fake'})
    editor=add_member(client,'editor@firma.com','editor');approver=add_member(client,'onay@firma.com','approver')
    with user_client('editor@firma.com',editor) as ed:
        r=post(ed);assert r.status_code==202 and r.json()['outcome']=='submitted'
        cid=r.json()['id']
        assert deliveries(cid)==[]  # nothing is queued before approval
        assert ed.post(f'/api/posts/{cid}/approve',json={}).status_code==403
        assert ed.post('/api/connections',json={'platform':'x','token':'hijack'}).status_code==403
    with user_client('onay@firma.com',approver) as ap:
        assert ap.post(f'/api/posts/{cid}/reject',json={'note':''}).status_code==400
        assert ap.post(f'/api/posts/{cid}/approve',json={'note':'Tamam'}).status_code==200
    rows=deliveries(cid);assert len(rows)==1 and rows[0].status=='pending'
    with Session() as db:
        c=db.get(Content,cid);assert c.status=='processing' and c.approved_by and c.approved_by!=c.created_by
        actions=[a.action for a in db.scalars(select(AuditLog).where(AuditLog.target_id==cid).order_by(AuditLog.created_at))]
    assert 'content.submitted' in actions and 'content.approved' in actions

def test_reject_then_edit_and_resubmit(client):
    client.post('/api/connections',json={'platform':'x','token':'fake'})
    editor=add_member(client,'e2@firma.com','editor')
    with user_client('e2@firma.com',editor) as ed:
        cid=post(ed).json()['id']
        assert client.post(f'/api/posts/{cid}/reject',json={'note':'Görsel ekle'}).status_code==200
        state=ed.get('/api/state').json();p=next(p for p in state['posts'] if p['id']==cid)
        assert p['status']=='rejected' and p['review_note']=='Görsel ekle'
        r=ed.put(f'/api/posts/{cid}',json={'text':'Düzeltildi','platforms':['x'],'send':True})
        assert r.json()['outcome']=='submitted'

def test_admin_without_approval_requirement_publishes_directly(client):
    client.post('/api/connections',json={'platform':'x','token':'fake'})
    client.patch('/api/company',json={'require_approval':False})
    editor=add_member(client,'e3@firma.com','editor')
    with user_client('e3@firma.com',editor) as ed:
        assert post(ed).json()['outcome']=='approved'

def test_viewer_is_read_only(client):
    viewer=add_member(client,'izle@firma.com','viewer')
    with user_client('izle@firma.com',viewer) as v:
        assert v.get('/api/state').status_code==200
        assert post(v).status_code==403
        assert v.post('/api/media',files={'file':('a.png',b'x','image/png')}).status_code==403
        assert v.get('/api/audit').status_code==403
        assert v.get('/api/state').json()['settings']['oauth_apps']==[]

def test_companies_are_isolated(client):
    client.post('/api/connections',json={'platform':'x','token':'company-a-secret','label':'A hesabı'})
    a_post=post(client).json()['id']
    r=client.post('/api/system/companies',json={'name':'Firma B','admin_email':'b@firmab.com'})
    b_company=r.json()['id'];b_password=r.json()['temporary_password'];assert b_password
    with user_client('b@firmab.com',b_password) as b:
        s=b.get('/api/state').json()
        assert s['company']['name']=='Firma B' and s['posts']==[] and s['connections']==[]
        assert b.post(f'/api/posts/{a_post}/approve',json={}).status_code==404
        assert b.get('/api/system/overview').status_code==403
        # Asking for another company's workspace explicitly is refused.
        a_company=client.get('/api/state').json()['company']['id']
        assert b.get('/api/state',headers={'X-Akis-Company':a_company}).status_code==403
    # The system admin is a member of A only; B's data needs B membership.
    assert client.get('/api/state',headers={'X-Akis-Company':b_company}).status_code==403

def test_system_overview_never_exposes_secrets(client,job,monkeypatch):
    identifier=job()
    assert client.post('/api/connections',json={'platform':'x','token':'very-secret-token','refresh_token':'very-secret-refresh'}).status_code==200
    client.post('/api/settings/oauth',json={'platform':'instagram','client_id':'cid','client_secret':'app-secret-value','redirect_uri':'http://localhost:5173/api/oauth/instagram/callback'})
    from akis.errors import PlatformError
    def fail(*a,**k): raise PlatformError('x','403')
    monkeypatch.setattr('akis.tasks.x_publisher.request',fail)
    run_delivery(identifier)
    r=client.get('/api/system/overview');assert r.status_code==200
    text=r.text
    for secret in ('very-secret-token','very-secret-refresh','app-secret-value'): assert secret not in text
    body=r.json();assert body['failures'][0]['error_code']=='403' and body['health']['database']
    audit=client.get('/api/audit').text
    for secret in ('very-secret-token','very-secret-refresh','app-secret-value'): assert secret not in audit

def test_delivery_attempts_are_recorded(job,monkeypatch):
    identifier=job()
    from akis.errors import PlatformError
    calls={'n':0}
    def flaky(*a,**k):
        calls['n']+=1
        if calls['n']==1: raise PlatformError('x','503',retryable=True)
        return {'data':{'id':'tweet-9'}}
    monkeypatch.setattr('akis.tasks.x_publisher.request',flaky)
    run_delivery(identifier)
    with Session() as db: row=db.get(ContentPlatform,identifier);row.next_attempt_at=0;db.commit()
    run_delivery(identifier)
    with Session() as db:
        attempts=list(db.scalars(select(DeliveryAttempt).where(DeliveryAttempt.delivery_id==identifier).order_by(DeliveryAttempt.started_at,DeliveryAttempt.outcome)))
    outcomes=sorted(a.outcome for a in attempts)
    assert outcomes==['retry','sent'] and all(a.finished_at for a in attempts)
    assert next(a for a in attempts if a.outcome=='retry').error_code=='503'

def test_scheduling_uses_company_timezone_and_waits(client,monkeypatch):
    client.post('/api/connections',json={'platform':'x','token':'fake'})
    client.patch('/api/company',json={'timezone':'America/New_York'})
    local=datetime.fromtimestamp(time.time()+7200,ZoneInfo('America/New_York')).strftime('%Y-%m-%dT%H:%M')
    r=post(client,scheduled_local=local);cid=r.json()['id']
    expected=int(datetime.strptime(local,'%Y-%m-%dT%H:%M').replace(tzinfo=ZoneInfo('America/New_York')).timestamp())
    with Session() as db: c=db.get(Content,cid);assert c.status=='scheduled' and c.scheduled_at==expected
    assert deliveries(cid)[0].next_attempt_at==expected
    calls=[];monkeypatch.setattr('akis.jobs.celery.send_task',lambda name,args: calls.append(name))
    dispatch();assert calls==[]  # not due yet
    assert client.post(f'/api/posts/{cid}/cancel').status_code==200
    assert deliveries(cid)==[] and client.get('/api/state').json()['posts'][0]['status']=='draft'
    assert post(client,scheduled_local='2020-01-01T10:00').status_code==400

def test_media_library_folders_tags_and_delete_rules(client):
    f=io.BytesIO();Image.new('RGB',(300,300),'green').save(f,'PNG')
    asset=client.post('/api/media',files={'file':('logo.png',f.getvalue(),'image/png')}).json()['id']
    r=client.patch(f'/api/media/{asset}',json={'folder':'Kampanya','tags':['Logo','yaz ','logo']})
    assert r.json()['folder']=='Kampanya' and r.json()['tags']==['logo','yaz']
    lib=client.get('/api/media',params={'folder':'Kampanya','tag':'logo'}).json()
    assert [a['id'] for a in lib['items']]==[asset] and lib['folders']==['Kampanya']
    client.post('/api/connections',json={'platform':'x','token':'fake'})
    post(client,asset_id=asset)
    assert client.delete(f'/api/media/{asset}').status_code==400  # used by sent content
    assert client.patch(f'/api/media/{asset}',json={'archived':True}).json()['archived']
    assert client.get('/api/media').json()['items']==[]

def test_two_factor_login(client):
    password=add_member(client,'guvenli@firma.com','editor')
    with user_client('guvenli@firma.com',password) as c:
        secret=c.post('/api/me/2fa/setup').json()['secret']
        assert c.post('/api/me/2fa/enable',json={'code':'000000'}).status_code==400
        assert c.post('/api/me/2fa/enable',json={'code':totp_code(secret,int(time.time()//30))}).status_code==200
    from fastapi.testclient import TestClient
    from akis.main import app
    with TestClient(app,base_url='http://localhost:5173',headers=ORIGIN) as c:
        c.post('/api/logout')
        password+='-kalici'
        r=c.post('/api/login',json={'email':'guvenli@firma.com','password':password})
        assert r.status_code==401 and r.json()['needs_code']
        assert c.post('/api/login',json={'email':'guvenli@firma.com','password':password,'code':'123456'}).status_code==401
        assert c.post('/api/login',json={'email':'guvenli@firma.com','password':password,'code':totp_code(secret,int(time.time()//30))}).status_code==200

def test_password_change_invalidates_old_sessions(client):
    password=add_member(client,'sifre@firma.com','viewer')
    with user_client('sifre@firma.com',password) as c:
        old_cookie=c.cookies.get('akis_session')
        assert c.post('/api/me/password',json={'current':password+'-kalici','new':'yeni-guclu-parola'}).status_code==200
        assert c.get('/api/state').status_code==200
        c.cookies.set('akis_session',old_cookie)
        assert c.get('/api/state').status_code==401

def test_last_admin_cannot_be_removed(client):
    me=client.get('/api/session').json()['user']['id']
    assert client.patch(f'/api/company/members/{me}',json={'role':'editor'}).status_code==400
    assert client.delete(f'/api/company/members/{me}').status_code==400

def test_backup_and_restore_check(client):
    client.post('/api/connections',json={'platform':'x','token':'fake'})
    post(client)
    r=client.post('/api/system/backup');assert r.status_code==200,r.text
    body=r.json();assert body['verified'] and body['counts']['contents']==1 and body['counts']['users']>=1
    assert client.post(f"/api/system/backup/{body['file']}/verify").json()['ok']
    assert client.post('/api/system/backup/..%2F..%2Fetc/verify').status_code in (400,404)

def test_cloudinary_upload_and_url(client,monkeypatch):
    from akis import storage
    uploaded=[]
    monkeypatch.setattr(storage,'enabled',lambda: True)
    monkeypatch.setattr(storage,'upload',lambda path,asset: uploaded.append(asset.id) or (f'https://res.cloudinary.com/demo/image/upload/akis/{asset.company_id}/{asset.id}.jpg',f'akis/{asset.company_id}/{asset.id}'))
    f=io.BytesIO();Image.new('RGB',(400,400),'red').save(f,'WEBP')
    identifier=client.post('/api/media',files={'file':('p.webp',f.getvalue(),'image/webp')}).json()['id']
    from akis.media import process_asset
    process_asset(identifier)
    asset=client.get('/api/media/'+identifier).json()
    assert uploaded==[identifier] and asset['stored']=='cloudinary' and asset['url'].startswith('https://res.cloudinary.com/')
    # Instagram gets the public Cloudinary URL even without a public server address.
    from akis.media import media_url
    with Session() as db: assert media_url(db.get(MediaAsset,identifier),db,public=True).startswith('https://res.cloudinary.com/')
    deleted=[];monkeypatch.setattr(storage,'delete',lambda a: deleted.append(a.id))
    assert client.delete('/api/media/'+identifier).status_code==200 and deleted==[identifier]

def test_worker_downloads_from_cloudinary_when_local_copy_missing(monkeypatch,tmp_path):
    from akis import storage
    from akis.models import MediaAsset
    a=MediaAsset(id='x1',company_id='c',filename='f',storage_key='missing-file.jpg',mime_type='image/jpeg',remote_url='https://res.cloudinary.com/demo/image/upload/x.jpg')
    class Fake:
        def __enter__(self): return self
        def __exit__(self,*a): pass
        def raise_for_status(self): pass
        def iter_bytes(self,n): yield b'remote-bytes'
    monkeypatch.setattr(storage.httpx,'stream',lambda *a,**k: Fake())
    with storage.local_file(a) as path: assert path.read_bytes()==b'remote-bytes'
    assert not path.exists()
    a.remote_url='https://evil.example/x.jpg'
    with pytest.raises(FileNotFoundError):
        with storage.local_file(a): pass

def test_backup_cli_runs_standalone(client,tmp_path):
    # Runs in a fresh interpreter: the backup module must register every table itself.
    import os,subprocess,sys
    from pathlib import Path
    from akis.config import settings
    root=Path(__file__).resolve().parents[2]
    env={**os.environ,'DATABASE_URL':settings.database_url,'BACKUP_DIR':str(tmp_path),'CLOUDINARY_URL':''}
    r=subprocess.run([sys.executable,str(root/'scripts'/'backup.py'),'create'],capture_output=True,text=True,env=env,timeout=120)
    assert r.returncode==0,r.stderr
    body=json.loads(r.stdout)
    assert body['verified'] and body['counts']['users']>=1 and 'delivery_attempts' in body['counts']
