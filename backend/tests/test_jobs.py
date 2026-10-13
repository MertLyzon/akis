from sqlalchemy import select
from akis.db import Session
from akis.models import Company,Content,ContentPlatform,MediaAsset,User,now
from akis.jobs import run_delivery,recover_stale,dispatch
from akis.errors import PlatformError

def get(identifier):
    with Session() as db: return db.get(ContentPlatform,identifier)

def test_success_and_duplicate_job(job,monkeypatch):
    identifier=job();calls=[]
    monkeypatch.setattr('akis.tasks.x_publisher.request',lambda *a,**k: calls.append(a) or {'data':{'id':'tweet-1'}})
    run_delivery(identifier);run_delivery(identifier)
    assert get(identifier).status=='sent' and len(calls)==1

def test_transient_errors_retry_only_three_times(job,monkeypatch):
    identifier=job()
    def fail(*a,**kw): raise PlatformError('x','429',retryable=True)
    monkeypatch.setattr('akis.tasks.x_publisher.request',fail)
    for attempt in range(4):
        with Session() as db:
            row=db.get(ContentPlatform,identifier);row.next_attempt_at=0;db.commit()
        run_delivery(identifier)
        assert get(identifier).retry_count==min(3,attempt+1)
    assert get(identifier).status=='failed'

def test_permanent_errors_are_not_retried(job,monkeypatch):
    identifier=job()
    def fail(*a,**kw): raise PlatformError('x','403')
    monkeypatch.setattr('akis.tasks.x_publisher.request',fail)
    run_delivery(identifier);row=get(identifier)
    assert row.status=='failed' and row.retry_count==0 and 'tweet.write' in row.error_message

def test_uncertain_final_request_is_not_replayed(job,monkeypatch):
    identifier=job()
    def fail(*a,**kw): raise PlatformError('x','network',ambiguous=True)
    monkeypatch.setattr('akis.tasks.x_publisher.request',fail)
    run_delivery(identifier)
    assert get(identifier).status=='unknown'

def test_crashed_worker_recovery(job):
    identifier=job()
    with Session() as db:
        row=db.get(ContentPlatform,identifier);row.status='sending';row.updated_at=now()-1000;row.final_request_started=True;db.commit();recover_stale(db)
    assert get(identifier).status=='unknown'

def test_dispatch_uses_platform_task(job,monkeypatch):
    identifier=job();calls=[]
    monkeypatch.setattr('akis.jobs.celery.send_task',lambda name,args: calls.append((name,args)))
    dispatch()
    assert calls==[('akis.send_to_x',[identifier])]

def test_dispatch_prioritizes_oldest_due_work(client,monkeypatch):
    with Session() as db:
        company_id=db.scalar(select(Company.id));user_id=db.scalar(select(User.id))
        for index in range(105):
            content=Content(id=f'content-{index:03}',company_id=company_id,created_by=user_id,body_text='queued',platforms=['x'],status='processing')
            db.add(content);db.flush()
            db.add(ContentPlatform(id=f'delivery-{index:03}',content_id=content.id,platform='x',status='pending',next_attempt_at=1000+index))
        for index in range(25):
            db.add(MediaAsset(id=f'asset-{index:03}',company_id=company_id,uploaded_by=user_id,filename='queued.jpg',storage_key='queued.jpg',mime_type='image/jpeg',status='processing',created_at=1000+index,updated_at=1000+index))
        db.commit()
    deliveries=[];media=[]
    monkeypatch.setattr('akis.jobs.celery.send_task',lambda name,args: deliveries.append(args[0]))
    monkeypatch.setattr('akis.jobs.process_media.delay',lambda identifier: media.append(identifier))
    dispatch()
    assert deliveries==[f'delivery-{index:03}' for index in range(100)]
    assert media==[f'asset-{index:03}' for index in range(20)]
