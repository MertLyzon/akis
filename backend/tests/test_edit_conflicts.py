import uuid
from datetime import datetime,timedelta,timezone
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from sqlalchemy import func, select

from akis.db import Session
from akis.models import AuditLog, Content, ContentPlatform


def draft(client):
    identifier=client.post('/api/posts',json={
        'requestId':str(uuid.uuid4()),'text':'Original','platforms':['x'],
    }).json()['id']
    return snapshot(client,identifier)


def snapshot(client,identifier):
    return next(p for p in client.get('/api/state').json()['posts'] if p['id']==identifier)


def edit(client,post,text,**extra):
    return client.put(f"/api/posts/{post['id']}",json={
        'text':text,'platforms':['x'],'expected_updated_at':post['updated_at'],**extra,
    })


def test_stale_edit_cannot_replace_a_newer_save_in_the_same_second(client,monkeypatch):
    original=draft(client)
    monkeypatch.setattr('akis.main.now',lambda:original['updated_at'])
    assert edit(client,original,'First editor').status_code==200
    current=snapshot(client,original['id'])
    assert current['updated_at']>original['updated_at']
    assert edit(client,original,'Stale editor').status_code==409
    assert snapshot(client,original['id'])['text']=='First editor'
    assert edit(client,current,'Compared and merged').status_code==200


def test_two_simultaneous_edits_have_only_one_winner(client):
    original=draft(client)
    barrier=Barrier(2)
    def save(text):
        barrier.wait(timeout=10)
        return text,edit(client,original,text).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(save,['Editor A','Editor B']))
    assert sorted(code for _,code in results)==[200,409]
    winner=next(text for text,code in results if code==200)
    assert snapshot(client,original['id'])['text']==winner
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(AuditLog).where(
            AuditLog.target_id==original['id'],AuditLog.action=='content.edited',
        ))==1


def test_invalid_edit_does_not_consume_the_opened_version(client):
    original=draft(client)
    assert edit(client,original,'').status_code==400
    assert snapshot(client,original['id'])['updated_at']==original['updated_at']
    assert edit(client,original,'Valid replacement').status_code==200


def test_stale_publish_does_not_queue_any_deliveries(client):
    original=draft(client)
    client.post('/api/connections',json={'platform':'x','token':'fake'})
    assert edit(client,original,'Updated draft').status_code==200
    assert edit(client,original,'Stale publish',send=True).status_code==409
    current=snapshot(client,original['id'])
    assert current['text']=='Updated draft' and current['status']=='draft'
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(ContentPlatform))==0


def test_older_client_save_also_invalidates_an_open_editor(client):
    original=draft(client)
    assert client.put(f"/api/posts/{original['id']}",json={
        'text':'Older desktop client','platforms':['x'],
    }).status_code==200
    assert edit(client,original,'Outdated web editor').status_code==409


def test_rejection_invalidates_the_open_editor(client):
    original=draft(client)
    with Session() as db:
        db.get(Content,original['id']).status='pending_approval'
        db.commit()
    assert client.post(f"/api/posts/{original['id']}/reject",json={'note':'Review changes'}).status_code==200
    assert edit(client,original,'Unaware of rejection').status_code==409
    current=snapshot(client,original['id'])
    assert current['status']=='rejected' and current['review_note']=='Review changes'


def pending_review(client):
    original=draft(client)
    with Session() as db:
        db.get(Content,original['id']).status='pending_approval'
        db.commit()
    return snapshot(client,original['id'])


def test_approval_cannot_publish_content_changed_since_review(client):
    client.post('/api/connections',json={'platform':'x','token':'fake'})
    original=pending_review(client)
    assert edit(client,original,'Changed after review').status_code==200
    with Session() as db:
        db.get(Content,original['id']).status='pending_approval'
        db.commit()
    response=client.post(f"/api/posts/{original['id']}/approve",json={'expected_updated_at':original['updated_at']})
    assert response.status_code==409
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(ContentPlatform))==0
        assert db.scalar(select(func.count()).select_from(AuditLog).where(
            AuditLog.target_id==original['id'],AuditLog.action=='content.approved',
        ))==0
    current=snapshot(client,original['id'])
    assert client.post(f"/api/posts/{original['id']}/approve",json={'expected_updated_at':current['updated_at']}).status_code==200


def test_simultaneous_approvals_queue_only_one_delivery(client):
    client.post('/api/connections',json={'platform':'x','token':'fake'})
    original=pending_review(client)
    barrier=Barrier(2)
    def approve(_):
        barrier.wait(timeout=10)
        return client.post(f"/api/posts/{original['id']}/approve",json={'expected_updated_at':original['updated_at']}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes=list(pool.map(approve,range(2)))
    assert sorted(codes)==[200,409]
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(ContentPlatform))==1
        assert db.scalar(select(func.count()).select_from(AuditLog).where(
            AuditLog.target_id==original['id'],AuditLog.action=='content.approved',
        ))==1


def test_approval_and_rejection_cannot_both_win(client):
    client.post('/api/connections',json={'platform':'x','token':'fake'})
    original=pending_review(client)
    barrier=Barrier(2)
    def review(action):
        barrier.wait(timeout=10)
        response=client.post(f"/api/posts/{original['id']}/{action}",json={'expected_updated_at':original['updated_at'],'note':'Review decision'})
        return action,response.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(review,['approve','reject']))
    assert sorted(code for _,code in results)==[200,409]
    winner=next(action for action,code in results if code==200)
    current=snapshot(client,original['id'])
    assert current['status']==('processing' if winner=='approve' else 'rejected')
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(ContentPlatform))==(1 if winner=='approve' else 0)
        assert db.scalar(select(func.count()).select_from(AuditLog).where(
            AuditLog.target_id==original['id'],AuditLog.action.in_(['content.approved','content.rejected']),
        ))==1


def test_failed_review_validation_does_not_advance_version(client):
    original=pending_review(client)
    assert client.post(f"/api/posts/{original['id']}/reject",json={'note':'   ','expected_updated_at':original['updated_at']}).status_code==400
    assert client.post(f"/api/posts/{original['id']}/approve",json={'expected_updated_at':original['updated_at']}).status_code==400
    assert snapshot(client,original['id'])['updated_at']==original['updated_at']


def test_stale_delete_preserves_a_newer_draft_and_has_no_delete_audit(client):
    original=draft(client)
    assert edit(client,original,'Newer draft').status_code==200
    response=client.request('DELETE',f"/api/posts/{original['id']}",json={'expected_updated_at':original['updated_at']})
    assert response.status_code==409
    current=snapshot(client,original['id'])
    assert current['text']=='Newer draft'
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.target_id==original['id'],AuditLog.action=='content.deleted'))==0
    assert client.request('DELETE',f"/api/posts/{original['id']}",json={'expected_updated_at':current['updated_at']}).status_code==200
    with Session() as db:
        assert db.get(Content,original['id']) is None
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.target_id==original['id'],AuditLog.action=='content.deleted'))==1


def scheduled(client):
    assert client.patch('/api/company',json={'timezone':'UTC'}).status_code==200
    assert client.post('/api/connections',json={'platform':'x','token':'fake'}).status_code==200
    when=(datetime.now(timezone.utc)+timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M')
    identifier=client.post('/api/posts',json={'requestId':str(uuid.uuid4()),'text':'Original plan','platforms':['x'],'send':True,'scheduled_local':when}).json()['id']
    return snapshot(client,identifier),when


def test_stale_cancel_cannot_cancel_a_new_plan_created_since_confirmation(client):
    original,when=scheduled(client)
    url=f"/api/posts/{original['id']}/cancel"
    assert client.post(url,json={'expected_updated_at':original['updated_at']}).status_code==200
    cancelled=snapshot(client,original['id'])
    assert cancelled['updated_at']>original['updated_at']
    assert edit(client,cancelled,'Replacement plan',send=True,scheduled_local=when).status_code==200
    current=snapshot(client,original['id'])
    assert client.post(url,json={'expected_updated_at':original['updated_at']}).status_code==409
    assert snapshot(client,original['id'])==current
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(ContentPlatform).where(ContentPlatform.content_id==original['id']))==1
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.target_id==original['id'],AuditLog.action=='content.schedule_cancelled'))==1
    assert client.post(url,json={'expected_updated_at':current['updated_at']}).status_code==200
    assert snapshot(client,original['id'])['status']=='draft'


def test_simultaneous_cancellations_have_only_one_winner(client):
    original,_=scheduled(client)
    barrier=Barrier(2)
    def cancel(_):
        barrier.wait(timeout=10)
        return client.post(f"/api/posts/{original['id']}/cancel",json={'expected_updated_at':original['updated_at']}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        codes=list(pool.map(cancel,range(2)))
    assert sorted(codes)==[200,409]
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(ContentPlatform))==0
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.target_id==original['id'],AuditLog.action=='content.schedule_cancelled'))==1


def test_invalid_cancel_or_delete_status_does_not_consume_the_opened_version(client):
    original=draft(client)
    assert client.post(f"/api/posts/{original['id']}/cancel",json={'expected_updated_at':original['updated_at']}).status_code==400
    assert snapshot(client,original['id'])['updated_at']==original['updated_at']
    planned,_=scheduled(client)
    assert client.request('DELETE',f"/api/posts/{planned['id']}",json={'expected_updated_at':planned['updated_at']}).status_code==400
    assert snapshot(client,planned['id'])['updated_at']==planned['updated_at']


def test_older_clients_can_cancel_and_delete_without_a_request_body(client):
    original,_=scheduled(client)
    assert client.post(f"/api/posts/{original['id']}/cancel").status_code==200
    assert edit(client,original,'Stale editor').status_code==409
    assert client.delete(f"/api/posts/{original['id']}").status_code==200

