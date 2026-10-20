from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session as OrmSession
from sqlalchemy.sql.dml import Update

from akis.db import Session
from akis.models import AuditLog, Content, ContentPlatform


def retry_count():
    with Session() as db:
        return db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action=='delivery.retried'))


def fail_delivery(identifier):
    with Session() as db:
        delivery=db.get(ContentPlatform,identifier)
        delivery.status='failed';delivery.retry_count=3;delivery.error_code='403';delivery.error_message='Test failure'
        delivery.final_request_started=False
        db.get(Content,delivery.content_id).status='attention'
        db.commit()


def test_manual_retry_accepts_one_failed_delivery_without_republishing(client,job):
    identifier=job();fail_delivery(identifier)
    response=client.post('/api/retry',json={'delivery_id':identifier})
    assert response.status_code==200 and response.json()=={'ok':True}
    with Session() as db:
        delivery=db.get(ContentPlatform,identifier)
        assert delivery.status=='pending' and delivery.retry_count==0
        assert delivery.error_code is None and delivery.error_message is None
        assert not delivery.final_request_started
        assert db.get(Content,delivery.content_id).status=='processing'
    assert client.post('/api/retry',json={'delivery_id':identifier}).status_code==400
    assert retry_count()==1


@pytest.mark.parametrize('status',['pending','queued','sending','sent','submitted','unknown'])
def test_manual_retry_rejects_active_successful_or_ambiguous_deliveries(client,job,status):
    identifier=job()
    with Session() as db:
        db.get(ContentPlatform,identifier).status=status;db.commit()
    assert client.post('/api/retry',json={'delivery_id':identifier}).status_code==400
    with Session() as db:
        assert db.get(ContentPlatform,identifier).status==status
    assert retry_count()==0


def test_manual_retry_losing_atomic_claim_does_not_report_success_or_change_content(client,job,monkeypatch):
    identifier=job();fail_delivery(identifier)
    original=OrmSession.execute

    def execute(db,statement,*args,**kwargs):
        if isinstance(statement,Update) and statement.table.name==ContentPlatform.__tablename__:
            return SimpleNamespace(rowcount=0)
        return original(db,statement,*args,**kwargs)

    monkeypatch.setattr(OrmSession,'execute',execute)
    response=client.post('/api/retry',json={'delivery_id':identifier})
    assert response.status_code==409
    with Session() as db:
        delivery=db.get(ContentPlatform,identifier)
        assert delivery.status=='failed' and delivery.retry_count==3
        assert db.get(Content,delivery.content_id).status=='attention'
    assert retry_count()==0
