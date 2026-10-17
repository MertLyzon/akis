from datetime import datetime,timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from sqlalchemy import func,select

from akis.db import Session
from akis.main import schedule_epoch
from akis.models import Content,ContentPlatform


@pytest.fixture
def fixed_clock(monkeypatch):
    current=int(datetime(2027,1,1,tzinfo=timezone.utc).timestamp())
    monkeypatch.setattr('akis.main.now',lambda:current)
    return current


@pytest.mark.parametrize('zone,local',[
    ('Europe/Istanbul','2027-03-28T02:30'),
    ('UTC','2027-10-31T02:30'),
    ('Europe/Berlin','2027-03-28T01:30'),
    ('Europe/Berlin','2027-03-28T03:30'),
    ('Europe/Berlin','2027-10-31T03:30'),
    ('America/New_York','2027-03-14T03:30'),
    ('Australia/Lord_Howe','2027-10-03T03:00'),
])
def test_unambiguous_times_round_trip_in_the_company_zone(fixed_clock,zone,local):
    stamp=schedule_epoch(local,zone)
    assert datetime.fromtimestamp(stamp,ZoneInfo(zone)).strftime('%Y-%m-%dT%H:%M')==local


@pytest.mark.parametrize('zone,local',[
    ('Europe/Berlin','2027-03-28T02:30'),
    ('America/New_York','2027-03-14T02:30'),
    ('Australia/Lord_Howe','2027-10-03T02:15'),
])
def test_missing_clock_times_are_rejected_instead_of_silently_shifted(fixed_clock,zone,local):
    with pytest.raises(HTTPException) as error: schedule_epoch(local,zone)
    assert error.value.status_code==400
    assert 'mevcut değil' in error.value.detail


@pytest.mark.parametrize('zone,local',[
    ('Europe/Berlin','2027-10-31T02:30'),
    ('America/New_York','2027-11-07T01:30'),
    ('Australia/Lord_Howe','2027-04-04T01:45'),
])
def test_repeated_clock_times_require_another_time_instead_of_picking_a_fold(fixed_clock,zone,local):
    with pytest.raises(HTTPException) as error: schedule_epoch(local,zone)
    assert error.value.status_code==400
    assert 'iki kez' in error.value.detail


@pytest.mark.parametrize('value',['bad','2027-02-30T12:00','2027-03-28T02:30Z','2027-03-28T02:30:00'])
def test_malformed_schedule_is_still_a_validation_error(fixed_clock,value):
    with pytest.raises(HTTPException) as error: schedule_epoch(value,'UTC')
    assert error.value.status_code==400


def test_empty_schedule_and_normal_date_limits_are_unchanged(fixed_clock):
    assert schedule_epoch('','UTC') is None
    assert schedule_epoch('2026-12-31T23:59','UTC')==fixed_clock-60
    assert schedule_epoch('2028-01-01T00:00','UTC')==fixed_clock+365*86400
    for value in ['2026-12-31T23:58','2028-01-01T00:01']:
        with pytest.raises(HTTPException) as error: schedule_epoch(value,'UTC')
        assert error.value.status_code==400


def test_invalid_company_zone_returns_a_validation_error(fixed_clock):
    with pytest.raises(HTTPException) as error: schedule_epoch('2027-05-01T12:00','not/a-zone')
    assert error.value.status_code==400
    assert 'saat dilimi geçersiz' in error.value.detail


@pytest.mark.parametrize('local',['2027-03-28T02:30','2027-10-31T02:30'])
@pytest.mark.parametrize('send',[False,True])
def test_api_rejects_clock_changes_without_creating_content_or_deliveries(client,fixed_clock,local,send):
    assert client.patch('/api/company',json={'timezone':'Europe/Berlin'}).status_code==200
    response=client.post('/api/posts',json={'requestId':str(uuid4()),'text':'Clock test','platforms':['x'],'send':send,'scheduled_local':local})
    assert response.status_code==400
    assert 'saat değişimi' in response.json()['error']
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(Content))==0
        assert db.scalar(select(func.count()).select_from(ContentPlatform))==0


def test_rejected_schedule_edit_preserves_existing_draft_and_version(client,fixed_clock):
    assert client.patch('/api/company',json={'timezone':'Europe/Berlin'}).status_code==200
    body={'requestId':str(uuid4()),'text':'Original text','platforms':['x'],'send':False,'scheduled_local':'2027-03-28T03:30'}
    created=client.post('/api/posts',json=body)
    assert created.status_code==202
    identifier=created.json()['id']
    with Session() as db:
        original=db.get(Content,identifier)
        before=(original.body_text,original.scheduled_at,original.updated_at,original.status)
    response=client.put('/api/posts/'+identifier,json={**body,'text':'Must not be stored','scheduled_local':'2027-03-28T02:30','expected_updated_at':before[2]})
    assert response.status_code==400
    with Session() as db:
        original=db.get(Content,identifier)
        assert (original.body_text,original.scheduled_at,original.updated_at,original.status)==before
        assert db.scalar(select(func.count()).select_from(ContentPlatform))==0
