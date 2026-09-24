import time
from PIL import Image
from sqlalchemy import select
from akis.db import Session
from akis.models import MediaAsset,ContentPlatform,AppSetting,Credential,OAuthApp,now
from akis.media import path_for
from akis.jobs import run_delivery
from akis.security import encrypt,decrypt
from conftest import company_id

def media(mime='image/jpeg'):
    with Session() as db:
        a=MediaAsset(company_id=company_id(),filename='sample',storage_key='sample.jpg',mime_type=mime,status='ready',width=500,height=500,size=0)
        db.add(a);db.flush();a.storage_key=a.id+('.jpg' if mime.startswith('image') else '.mp4')
        path=path_for(a.storage_key)
        if mime.startswith('image'): Image.new('RGB',(500,500),'blue').save(path)
        else: path.write_bytes(b'video-test-bytes')
        a.size=path.stat().st_size;db.commit();return a.id

def result(identifier):
    with Session() as db: return db.get(ContentPlatform,identifier)

def test_x_chunked_media_and_tweet_payload(job,monkeypatch):
    identifier=job(asset=media());calls=[]
    def fake(platform,method,url,token=None,**kwargs):
        calls.append((url,kwargs))
        if url.endswith('/initialize'): return {'data':{'id':'media-123'}}
        if url.endswith('/append'): assert kwargs['files']['media'][1];return {}
        if url.endswith('/finalize'): return {'data':{}}
        assert kwargs['json']['media']['media_ids']==['media-123']
        return {'data':{'id':'tweet-with-image'}}
    monkeypatch.setattr('akis.tasks.x_publisher.request',fake);run_delivery(identifier)
    assert result(identifier).status=='sent' and len(calls)==4

def test_instagram_waits_then_publishes_without_duplicate_container(job,monkeypatch):
    identifier=job('instagram',asset=media());calls=[];ready=[False]
    with Session() as db: db.add(AppSetting(key='public_base_url',value='https://akis.example'));db.commit()
    def fake(platform,method,url,token=None,**kwargs):
        calls.append(url)
        if url.endswith('/media'): assert kwargs['json']['image_url'].startswith('https://akis.example/api/media/');return {'id':'container'}
        if url.endswith('/media_publish'): return {'id':'instagram-post'}
        return {'status_code':'FINISHED' if ready[0] else 'IN_PROGRESS'}
    monkeypatch.setattr('akis.tasks.instagram_publisher.request',fake);run_delivery(identifier)
    assert result(identifier).status=='pending' and result(identifier).retry_count==0
    with Session() as db: r=db.get(ContentPlatform,identifier);r.next_attempt_at=0;db.commit()
    ready[0]=True;run_delivery(identifier)
    assert result(identifier).status=='sent';assert sum(x.endswith('/media') for x in calls)==1

def test_whatsapp_media_template_header(job,monkeypatch):
    identifier=job('whatsapp',asset=media(),recipient='905111111111',options={'template':'campaign','language':'tr','template_params':['Ada'],'wa_mode':'template'})
    def fake(platform,method,url,token=None,**kwargs):
        if url.endswith('/media'): assert kwargs['files']['file'][1].read();return {'id':'wa-media'}
        payload=kwargs['json'];assert payload['to']=='905111111111';assert payload['template']['components'][0]['parameters'][0]['image']['id']=='wa-media';assert payload['template']['components'][1]['parameters'][0]['text']=='Ada'
        return {'messages':[{'id':'wa-message'}]}
    monkeypatch.setattr('akis.tasks.whatsapp_sender.request',fake);run_delivery(identifier)
    assert result(identifier).status=='submitted' and result(identifier).external_post_id=='wa-message'

def test_tiktok_file_upload_does_not_need_public_domain(job,monkeypatch):
    identifier=job('tiktok',asset=media('video/mp4'));calls=[]
    monkeypatch.setattr('akis.jobs.variant_for',lambda db,asset,platform:asset)
    def fake(platform,method,url,token=None,**kwargs):
        calls.append((method,url))
        if url.endswith('/init/'):
            assert kwargs['json']['source_info']['source']=='FILE_UPLOAD'
            return {'data':{'publish_id':'tt-id','upload_url':'https://open-upload.tiktokapis.com/upload/test'}}
        if method=='PUT': assert kwargs['headers']['Content-Range'].startswith('bytes 0-');return {}
        return {'data':{'status':'SEND_TO_USER_INBOX'}}
    monkeypatch.setattr('akis.tasks.tiktok_publisher.request',fake);run_delivery(identifier)
    assert result(identifier).status=='submitted';assert len(calls)==3
    assert 'upload_url' in result(identifier).progress and 'https://' not in result(identifier).progress['upload_url']

def test_tiktok_refresh_rotation(monkeypatch):
    from akis.tokens import refresh_credential
    cid=company_id()
    with Session() as db:
        c=Credential(company_id=cid,platform='tiktok',access_token=encrypt('old'),refresh_token=encrypt('old-refresh'),expires_at=now()+5)
        db.add(c);db.add(OAuthApp(company_id=cid,platform='tiktok',client_id='key',client_secret=encrypt('secret'),redirect_uri='https://test.example/api/oauth/tiktok/callback'));db.commit();identifier=c.id
    monkeypatch.setattr('akis.tokens.request',lambda *a,**k:{'access_token':'new','refresh_token':'new-refresh','expires_in':86400,'refresh_expires_in':31536000})
    assert refresh_credential(identifier)=='new'
    with Session() as db: c=db.get(Credential,identifier);assert decrypt(c.refresh_token)=='new-refresh' and c.refresh_expires_at>now()+30000000

def test_real_celery_worker_executes_registered_task(job,monkeypatch):
    from celery.contrib.testing.worker import start_worker
    from akis.queue import celery
    from akis.tasks.x_publisher import send_to_x
    identifier=job();monkeypatch.setattr('akis.tasks.x_publisher.request',lambda *a,**k:{'data':{'id':'worker-post'}})
    old=celery.conf.broker_url;celery.conf.broker_url='memory://'
    try:
        with start_worker(celery,pool='solo',perform_ping_check=False,shutdown_timeout=15):
            send_to_x.delay(identifier)
            deadline=time.monotonic()+10
            while result(identifier).status=='pending' and time.monotonic()<deadline: time.sleep(.1)
            while result(identifier).status=='sending' and time.monotonic()<deadline: time.sleep(.1)
            assert result(identifier).status=='sent'
    finally: celery.conf.broker_url=old
