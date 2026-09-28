import io,json,time,uuid
from urllib.parse import parse_qs,urlsplit
from PIL import Image
from sqlalchemy import select,func
from akis.db import Session
from akis.models import AuditLog,AppSetting,Company,ContentPlatform,DeliveryAttempt,MediaAsset,OAuthState,User,now
from akis.media import media_url,process_asset,path_for
from akis.jobs import run_delivery,housekeeping
from akis.tasks.common import Waiting
from test_companies import add_member,user_client

def png(name='kampanya.png'):
    out=io.BytesIO();Image.new('RGB',(40,40),'red').save(out,'PNG');return {'file':(name,out.getvalue(),'image/png')}

def test_state_etag_answers_304_when_nothing_changed(client):
    first=client.get('/api/state');etag=first.headers['etag']
    again=client.get('/api/state',headers={'If-None-Match':etag})
    assert again.status_code==304 and again.content==b''
    client.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':'Yeni taslak','platforms':['x']})
    changed=client.get('/api/state',headers={'If-None-Match':etag})
    assert changed.status_code==200 and changed.headers['etag']!=etag

def test_state_is_gzipped_and_media_file_is_not(client):
    for i in range(30): client.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':f'Taslak {i} '*20,'platforms':['x']})
    r=client.get('/api/state',headers={'Accept-Encoding':'gzip'})
    assert r.headers.get('content-encoding')=='gzip'
    asset=client.post('/api/media',files=png()).json()['id'];process_asset(asset)
    f=client.get(f'/api/media/{asset}/file',headers={'Accept-Encoding':'gzip'})
    assert f.status_code==200 and 'content-encoding' not in f.headers

def test_signed_media_url_is_stable_between_polls(client):
    asset=client.post('/api/media',files=png()).json()['id'];process_asset(asset)
    with Session() as db:
        a=db.get(MediaAsset,asset);first=media_url(a,db)
        time.sleep(1.1);assert media_url(a,db)==first
    assert client.get(first).status_code==200

def test_failed_media_leaves_no_files(client):
    r=client.post('/api/media',files={'file':('bozuk.mp4',b'\x00\x00\x00\x18ftypmp42'+b'\x00'*64,'video/mp4')})
    asset=r.json()['id']
    with Session() as db: key=db.get(MediaAsset,asset).storage_key
    assert path_for(key).exists()
    process_asset(asset)
    with Session() as db: assert db.get(MediaAsset,asset).status=='failed'
    assert not path_for(key).exists()

def test_unknown_email_takes_the_same_path_as_wrong_password(client,monkeypatch):
    calls=[]
    import akis.main as main
    real=main.verify_password
    monkeypatch.setattr(main,'verify_password',lambda p,s: calls.append(s) or real(p,s))
    client.post('/api/logout')
    assert client.post('/api/login',json={'email':'yok@firma.com','password':'x'}).status_code==401
    assert calls==['']  # hashed anyway, so response time does not reveal the account

def test_oauth_callback_refuses_revoked_session(client,monkeypatch):
    client.post('/api/settings/oauth',json={'platform':'x','client_id':'client','redirect_uri':'http://localhost:5173/api/oauth/x/callback'})
    state=parse_qs(urlsplit(client.post('/api/oauth/start',json={'platform':'x'}).json()['url']).query)['state'][0]
    with Session() as db:
        u=db.scalar(select(User).where(User.is_system_admin==True));u.session_version+=1;db.commit()
    monkeypatch.setattr('akis.oauth.exchange',lambda *a:({'access_token':'fake'},'1','x','oauth'))
    assert 'Hesabın bağlandı' not in client.get('/api/oauth/x/callback',params={'state':state,'code':'c'}).text

def test_revoke_other_sessions_keeps_this_device(client):
    password=add_member(client,'cihaz@firma.com','viewer')
    with user_client('cihaz@firma.com',password) as phone, user_client('cihaz@firma.com',password) as laptop:
        assert laptop.post('/api/me/sessions/revoke').status_code==200
        assert laptop.get('/api/state').status_code==200
        assert phone.get('/api/state').status_code==401

def test_audit_pages_do_not_skip_entries_in_the_same_second(client):
    with Session() as db:
        cid=db.scalar(select(Company.id));stamp=now()-100
        for i in range(7): db.add(AuditLog(company_id=cid,action='test.same_second',created_at=stamp))
        db.commit()
    seen=[];cursor={}
    while True:
        items=client.get('/api/audit',params={'action':'test.','limit':3,**cursor}).json()['items']
        seen+=[i['id'] for i in items]
        if len(items)<3: break
        cursor={'before':items[-1]['at'],'before_id':items[-1]['id']}
    assert len(seen)==len(set(seen))==7

def test_library_search_treats_wildcards_literally(client):
    client.post('/api/media',files=png('yaz_kampanyasi.png'));client.post('/api/media',files=png('yazXkampanyasi.png'))
    assert [a['filename'] for a in client.get('/api/media',params={'q':'yaz_'}).json()['items']]==['yaz_kampanyasi.png']
    assert len(client.get('/api/media',params={'q':'%'}).json()['items'])==0

def test_waiting_polls_reuse_one_attempt(job,monkeypatch):
    identifier=job()
    def still_processing(ctx): raise Waiting(10,'İşleniyor')
    monkeypatch.setattr('akis.tasks.x_publisher.publish',still_processing)
    for _ in range(5):
        with Session() as db: db.get(ContentPlatform,identifier).next_attempt_at=0;db.commit()
        run_delivery(identifier)
    with Session() as db: assert db.scalar(select(func.count()).select_from(DeliveryAttempt).where(DeliveryAttempt.delivery_id==identifier))==1

def test_housekeeping_drops_expired_rows(client):
    with Session() as db:
        db.add(OAuthState(id='old',company_id='c',session_hash='h',platform='x',verifier='v',expires_at=now()-7200))
        db.add(OAuthState(id='live',company_id='c',session_hash='h',platform='x',verifier='v',expires_at=now()+600))
        db.add(AppSetting(key='login:lapsed',value=json.dumps({'count':3,'until':now()-10})))
        db.add(AppSetting(key='login:active',value=json.dumps({'count':3,'until':now()+600})))
        db.commit()
    housekeeping()
    with Session() as db:
        assert db.get(OAuthState,'old') is None and db.get(OAuthState,'live')
        assert db.get(AppSetting,'login:lapsed') is None and db.get(AppSetting,'login:active')
