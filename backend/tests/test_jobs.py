from sqlalchemy import select
from akis.db import Session
from akis.models import ContentPlatform,now
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
