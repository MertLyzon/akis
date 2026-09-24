"""Native (Tauri) apps: cross-origin, bearer token instead of cookies."""
from fastapi.testclient import TestClient

APP={'Origin':'tauri://localhost','X-Akis-Client':'app'}

def app_client():
    from akis.main import app
    return TestClient(app,base_url='http://127.0.0.1:8000')

def test_cors_preflight_allows_app_origin_only(client):
    c=app_client()
    ok=c.options('/api/login',headers={'Origin':'tauri://localhost','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-akis-client'})
    assert ok.status_code==200 and ok.headers['access-control-allow-origin']=='tauri://localhost'
    bad=c.options('/api/login',headers={'Origin':'https://evil.example','Access-Control-Request-Method':'POST'})
    assert 'access-control-allow-origin' not in bad.headers

def test_app_login_returns_token_and_bearer_works(client):
    r=client.post('/api/company/members',json={'email':'mobil@firma.com','role':'editor'});password=r.json()['temporary_password']
    c=app_client()
    r=c.post('/api/login',json={'email':'mobil@firma.com','password':password},headers=APP)
    assert r.status_code==200 and r.json()['token'] and 'akis_session' not in r.cookies
    token=r.json()['token'];auth={**APP,'Authorization':'Bearer '+token}
    # Temporary password must be replaced first; the new token comes back in the body.
    r=c.post('/api/me/password',json={'current':password,'new':'mobil-kalici-parola'},headers=auth);assert r.status_code==200
    auth['Authorization']='Bearer '+r.json()['token']
    assert c.get('/api/session',headers={**auth,'Sec-Fetch-Site':'cross-site'}).json()['user']['email']=='mobil@firma.com'
    assert c.get('/api/state',headers=auth).status_code==200
    assert c.get('/api/state',headers={**APP,'Authorization':'Bearer '+token}).status_code==401  # old token died with the password change

def test_web_login_never_exposes_token(client):
    client.post('/api/company/members',json={'email':'web@firma.com','role':'viewer'})
    r=client.post('/api/login',json={'email':'web@firma.com','password':'wrong'})
    assert 'token' not in r.json()

def test_app_origin_without_session_is_rejected(client):
    c=app_client()
    assert c.get('/api/state',headers=APP).status_code==401
    assert c.get('/api/session',headers=APP).json()['authenticated'] is False  # no local auto-login for apps
