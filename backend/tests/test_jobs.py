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
    dispatch();dispatch()
    assert calls==[('akis.send_to_x',[identifier])]
    assert get(identifier).status=='queued'

def test_worker_accepts_a_claimed_delivery(job,monkeypatch):
    identifier=job();calls=[]
    with Session() as db:
        row=db.get(ContentPlatform,identifier);row.status='queued';db.commit()
    monkeypatch.setattr('akis.tasks.x_publisher.request',lambda *a,**k: calls.append(a) or {'data':{'id':'tweet-queued'}})
    run_delivery(identifier)
    assert get(identifier).status=='sent' and len(calls)==1

def test_broker_failure_releases_claim(job,monkeypatch):
    identifier=job()
    def unavailable(*args,**kwargs): raise ConnectionError('broker unavailable')
    monkeypatch.setattr('akis.jobs.celery.send_task',unavailable)
    dispatch()
    assert get(identifier).status=='pending'

def test_stale_broker_claims_are_recovered(job,client):
    identifier=job()
    with Session() as db:
        delivery=db.get(ContentPlatform,identifier);delivery.status='queued';delivery.updated_at=now()-1000
        company_id=db.scalar(select(Company.id));user_id=db.scalar(select(User.id))
        asset=MediaAsset(id='stale-queued-asset',company_id=company_id,uploaded_by=user_id,filename='queued.jpg',storage_key='queued.jpg',mime_type='image/jpeg',status='queued',created_at=1000,updated_at=now()-1000)
        db.add(asset);db.commit();recover_stale(db)
    assert get(identifier).status=='pending'
    with Session() as db: assert db.get(MediaAsset,'stale-queued-asset').status=='processing'

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
    dispatch();dispatch();dispatch()
    assert deliveries==[f'delivery-{index:03}' for index in range(105)]
    assert media==[f'asset-{index:03}' for index in range(25)]

def test_idle_recovery_sweeps_allow_neon_to_suspend():
    from akis.queue import IDLE_DATABASE_SWEEP_SECONDS,IDLE_DATABASE_SWEEP_MINUTES,beat_schedule
    assert IDLE_DATABASE_SWEEP_SECONDS>300
    assert beat_schedule['outbox']['schedule']._orig_minute==f'*/{IDLE_DATABASE_SWEEP_MINUTES}'
    assert beat_schedule['tokens']['schedule']._orig_minute==f'*/{IDLE_DATABASE_SWEEP_MINUTES}'

def test_new_media_is_enqueued_without_waiting_for_sweep(client,monkeypatch):
    from akis.config import settings
    from akis.jobs import enqueue_media
    with Session() as db:
        cid=db.scalar(select(Company.id));uid=db.scalar(select(User.id))
        db.add(MediaAsset(id='new-asset',company_id=cid,uploaded_by=uid,filename='new.jpg',storage_key='new.jpg',mime_type='image/jpeg',status='processing'))
        db.commit()
    queued=[]
    monkeypatch.setattr(settings,'queue_mode','celery')
    monkeypatch.setattr('akis.jobs.process_media.delay',lambda identifier: queued.append(identifier))
    enqueue_media('new-asset')
    assert queued==['new-asset']
    with Session() as db: assert db.get(MediaAsset,'new-asset').status=='queued'

def test_direct_media_enqueue_releases_claim_when_broker_fails(client,monkeypatch):
    from akis.config import settings
    from akis.jobs import enqueue_media
    with Session() as db:
        cid=db.scalar(select(Company.id));uid=db.scalar(select(User.id))
        db.add(MediaAsset(id='new-asset-fail',company_id=cid,uploaded_by=uid,filename='new.jpg',storage_key='new.jpg',mime_type='image/jpeg',status='processing'))
        db.commit()
    def unavailable(_identifier): raise ConnectionError('broker unavailable')
    monkeypatch.setattr(settings,'queue_mode','celery')
    monkeypatch.setattr('akis.jobs.process_media.delay',unavailable)
    enqueue_media('new-asset-fail')
    with Session() as db: assert db.get(MediaAsset,'new-asset-fail').status=='processing'
