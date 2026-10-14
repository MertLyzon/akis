import time

import fakeredis
from fastapi.testclient import TestClient

from akis import release_info
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


def test_release_info_uses_and_sanitizes_deployment_sha(monkeypatch):
    monkeypatch.setenv('NF_DEPLOYMENT_SHA','ABCDEF0123456789')
    assert release_info()=={'version':'0.4.0','commit':'abcdef012345'}
    monkeypatch.setenv('NF_DEPLOYMENT_SHA','not-a-commit-or-secret')
    assert release_info()=={'version':'0.4.0','commit':''}


def test_liveness_exposes_public_release_identity(client):
    response=client.get('/api/health')
    assert response.status_code==200
    assert response.json()['release']['version']=='0.4.0'
    assert len(response.headers['x-request-id'])==12


def test_unexpected_errors_return_a_safe_support_code(client,monkeypatch):
    from akis.main import app
    from akis.diagnostics import clear_api_errors
    clear_api_errors()
    try:
        monkeypatch.setattr('akis.main.release_info',lambda:(_ for _ in ()).throw(RuntimeError('secret database detail')))
        with TestClient(app,base_url='http://localhost:5173',headers={'Origin':'http://localhost:5173'},raise_server_exceptions=False) as error_client:
            response=error_client.get('/api/health?token=must-not-appear')
        body=response.json()
        assert response.status_code==500
        assert body['error']=='İşlem tamamlanamadı.'
        assert len(body['support_code'])==12
        assert response.headers['x-request-id']==body['support_code']
        assert 'secret database detail' not in response.text
        overview=client.get('/api/system/overview').json()
        assert overview['api_errors'][0]=={'at':overview['api_errors'][0]['at'],'support_code':body['support_code'],'method':'GET','path':'/api/health'}
        assert 'must-not-appear' not in str(overview['api_errors'])
    finally:
        clear_api_errors()
