import io,json,uuid
from PIL import Image
from sqlalchemy import select,func
from akis.db import Session
from akis.models import Credential,Content,ContentPlatform
from akis.security import decrypt
from akis.media import process_asset

def test_auth_and_csrf(client):
    client.cookies.clear()
    assert client.get('/api/state').status_code==401
    assert client.get('/api/session',headers={'Sec-Fetch-Site':'cross-site'}).status_code==403
    client.get('/api/session')
    r=client.post('/api/connections',json={'platform':'x','token':'fake'},headers={'Origin':'https://attacker.example'})
    assert r.status_code==403

def test_secret_storage_and_expiry(client):
    r=client.post('/api/connections',json={'platform':'x','token':'fake-access-secret','refresh_token':'fake-refresh-secret','expires_at':1900000000})
    assert r.status_code==200
    s=client.get('/api/state')
    assert 'fake-access-secret' not in s.text and 'fake-refresh-secret' not in s.text
    assert s.json()['connections'][0]['expires_at']==1900000000
    with Session() as db:
        c=db.scalar(select(Credential));assert c.access_token!='fake-access-secret';assert decrypt(c.refresh_token)=='fake-refresh-secret'

def test_draft_idempotency_and_conflict(client):
    body={'requestId':str(uuid.uuid4()),'text':'Taslak','platforms':['x'],'send':False}
    assert client.post('/api/posts',json=body).status_code==202
    assert client.post('/api/posts',json=body).json()['alreadySaved']
    assert client.post('/api/posts',json={**body,'text':'Farklı'}).status_code==409
    with Session() as db: assert db.scalar(select(func.count()).select_from(Content))==1

def test_posts_are_queued_without_network(client,monkeypatch):
    def unexpected(*a,**k): raise AssertionError('No platform call during API request')
    monkeypatch.setattr('akis.tasks.x_publisher.request',unexpected)
    client.post('/api/connections',json={'platform':'x','token':'fake'})
    r=client.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':'queued','platforms':['x'],'send':True})
    assert r.status_code==202 and r.json()['queued']
    assert client.get('/api/state').json()['posts'][0]['deliveries'][0]['status']=='pending'

def test_upload_processing_and_signed_media(client):
    f=io.BytesIO();Image.new('RGB',(400,100),'red').save(f,'WEBP')
    r=client.post('/api/media',files={'file':('example.webp',f.getvalue(),'image/webp')})
    assert r.status_code==202
    identifier=r.json()['id'];process_asset(identifier)
    asset=client.get('/api/media/'+identifier).json();assert asset['status']=='ready';assert asset['mime_type']=='image/jpeg';assert .8<=asset['width']/asset['height']<=1.91
    signed=asset['url'];client.cookies.clear()
    assert client.get(signed).status_code==200
    assert client.get(signed.replace('signature=','signature=invalid')).status_code==403

def test_invalid_upload_and_validation_do_not_leak(client):
    assert client.post('/api/media',files={'file':('fake.jpg',b'<html>not an image</html>','image/jpeg')}).status_code==400
    r=client.post('/api/connections',json={'platform':'invalid','token':'sensitive-test'})
    assert r.status_code==422 and 'sensitive-test' not in r.text

def test_recipient_jobs_are_distinct(client):
    client.post('/api/connections',json={'platform':'whatsapp','account':'123','token':'fake'})
    r=client.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':'','platforms':['whatsapp'],'send':True,'template':'hello_world','language':'en_US','recipients':['905111111111','905222222222','905111111111']})
    assert r.status_code==202
    with Session() as db: assert db.scalar(select(func.count()).select_from(ContentPlatform))==2

def test_session_message_requires_confirmation(client):
    client.post('/api/connections',json={'platform':'whatsapp','account':'123','token':'fake'})
    r=client.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':'hi','platforms':['whatsapp'],'send':True,'wa_mode':'session','recipients':['905111111111']})
    assert r.status_code==400
