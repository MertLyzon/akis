import uuid
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

