import time

import fakeredis

from akis.config import settings
from akis.health import heartbeat_key,is_ready,service_health,write_heartbeat


def test_heartbeat_is_short_lived_and_timestamped():
    client=fakeredis.FakeRedis(decode_responses=True)
    stamp=write_heartbeat('worker',client=client,timestamp=1_700_000_000)
    assert stamp==1_700_000_000
    assert client.get(heartbeat_key('worker'))=='1700000000'
    assert 0<client.ttl(heartbeat_key('worker'))<=60


def test_service_health_reports_worker_and_beat(monkeypatch):
    client=fakeredis.FakeRedis(decode_responses=True)
    now=int(time.time())
    write_heartbeat('worker',client=client,timestamp=now)
    write_heartbeat('beat',client=client,timestamp=now)
    monkeypatch.setattr('akis.health.redis_client',lambda:client)
    monkeypatch.setattr('akis.health.storage.ping',lambda:True)
    monkeypatch.setattr(settings,'queue_mode','celery')
    health=service_health()
    assert health['database'] and health['redis']
    assert health['worker'] and health['beat']
    assert is_ready(health)


def test_readiness_rejects_a_stale_queue(client,monkeypatch):
    healthy={'database':True,'redis':True,'worker':True,'beat':True,'storage':True,'queue_mode':'celery','database_kind':'sqlite','checked_at':100,'worker_last_seen':100,'beat_last_seen':100}
    monkeypatch.setattr('akis.main.service_health',lambda:healthy)
    assert client.get('/api/ready').status_code==200
    monkeypatch.setattr('akis.main.service_health',lambda:{**healthy,'worker':False})
    response=client.get('/api/ready')
    assert response.status_code==503 and response.json()['ok'] is False


def test_local_mode_does_not_require_redis_or_queue_processes():
    assert is_ready({'database':True,'storage':None,'queue_mode':'local'})
