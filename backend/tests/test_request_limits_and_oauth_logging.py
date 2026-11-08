import logging
from urllib.parse import parse_qs, urlsplit

from akis.main import MAX_BODY_BYTES

JSON = {'Content-Type': 'application/json'}


def test_oversized_declared_json_body_is_refused_before_login(client):
    body = b'{"email":"a@b.co","password":"' + b'a' * (MAX_BODY_BYTES + 10) + b'"}'
    r = client.post('/api/login', content=body, headers=JSON)
    assert r.status_code == 413 and 'çok büyük' in r.json()['error']


def test_oversized_chunked_body_without_content_length_is_refused(client):
    def chunks():
        for _ in range(MAX_BODY_BYTES // 65536 + 3):
            yield b'a' * 65536
    r = client.post('/api/login', content=chunks(), headers=JSON)
    assert r.status_code == 413


def test_oversized_body_is_refused_for_non_json_content_type_too(client):
    r = client.post('/api/login', content=b'a' * (MAX_BODY_BYTES + 10), headers={'Content-Type': 'text/plain'})
    assert r.status_code == 413


def test_normal_json_body_still_reaches_the_endpoint_unchanged(client):
    # 401 (wrong password) proves the body was parsed; a lost body would give 422.
    r = client.post('/api/login', json={'email': 'nobody@example.test', 'password': 'wrong-password'})
    assert r.status_code == 401


def test_oauth_callback_logs_error_type_only(client, monkeypatch, caplog):
    client.post('/api/settings/oauth', json={'platform': 'x', 'client_id': 'client', 'redirect_uri': 'http://localhost:5173/api/oauth/x/callback'})
    state = parse_qs(urlsplit(client.post('/api/oauth/start', json={'platform': 'x'}).json()['url']).query)['state'][0]

    def boom(*args):
        raise RuntimeError('https://api.x.com/token?client_secret=SUPER-SECRET-VALUE')
    monkeypatch.setattr('akis.oauth.exchange', boom)
    caplog.set_level(logging.ERROR)
    r = client.get('/api/oauth/x/callback', params={'state': state, 'code': 'c'})
    assert 'Hesap bağlanamadı' in r.text
    assert 'OAuth callback failed platform=x error=RuntimeError' in caplog.text
    assert 'SUPER-SECRET-VALUE' not in caplog.text
