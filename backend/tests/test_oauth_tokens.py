import base64,hashlib,json
from urllib.parse import urlsplit,parse_qs
from sqlalchemy import select
from akis.db import Session
from akis.models import Credential,OAuthApp,OAuthState,now
from akis.security import encrypt,decrypt
from akis.tokens import refresh_credential
from conftest import company_id

def test_x_refresh_rotates_encrypted_tokens(monkeypatch):
    cid=company_id()
    with Session() as db:
        c=Credential(company_id=cid,platform='x',access_token=encrypt('old'),refresh_token=encrypt('old-refresh'),expires_at=now()+10)
        db.add(c);db.add(OAuthApp(company_id=cid,platform='x',client_id='client',redirect_uri='http://localhost:5173/api/oauth/x/callback'));db.commit();identifier=c.id
    def fake(*a,**k):
        assert k['data']['grant_type']=='refresh_token'
        return {'access_token':'new','refresh_token':'new-refresh','expires_in':7200}
    monkeypatch.setattr('akis.tokens.request',fake)
    assert refresh_credential(identifier)=='new'
    with Session() as db:
        c=db.get(Credential,identifier);assert decrypt(c.refresh_token)=='new-refresh';assert c.expires_at>now()+7100

def test_oauth_pkce_and_one_time_state(client,monkeypatch):
    client.post('/api/settings/oauth',json={'platform':'x','client_id':'client','redirect_uri':'http://localhost:5173/api/oauth/x/callback'})
    r=client.post('/api/oauth/start',json={'platform':'x'});assert r.status_code==200
    query=parse_qs(urlsplit(r.json()['url']).query);state=query['state'][0]
    with Session() as db:
        s=db.get(OAuthState,state);verifier=json.loads(decrypt(s.verifier))['verifier']
        assert query['code_challenge']==[base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')]
    monkeypatch.setattr('akis.oauth.exchange',lambda *args:({'access_token':'fake','refresh_token':'fake-r','expires_in':7200},'123','test','oauth'))
    r=client.get('/api/oauth/x/callback',params={'state':state,'code':'fake-code'})
    assert 'Hesabın bağlandı' in r.text
    assert 'daha önce kullanılmış' in client.get('/api/oauth/x/callback',params={'state':state,'code':'fake'}).text

def test_tiktok_desktop_hex_challenge_and_web_rule(client):
    body={'platform':'tiktok','client_id':'client','client_secret':'secret','redirect_uri':'http://localhost:5173/api/oauth/tiktok/callback','mode':'web'}
    assert client.post('/api/settings/oauth',json=body).status_code==400
    assert client.post('/api/settings/oauth',json={**body,'mode':'desktop'}).status_code==200
    query=parse_qs(urlsplit(client.post('/api/oauth/start',json={'platform':'tiktok'}).json()['url']).query)
    with Session() as db:
        s=db.get(OAuthState,query['state'][0]);v=json.loads(decrypt(s.verifier))['verifier'];assert query['code_challenge']==[hashlib.sha256(v.encode()).hexdigest()]

def test_oauth_state_is_bound_to_browser_session(client,monkeypatch):
    client.post('/api/settings/oauth',json={'platform':'x','client_id':'client','redirect_uri':'http://localhost:5173/api/oauth/x/callback'})
    state=parse_qs(urlsplit(client.post('/api/oauth/start',json={'platform':'x'}).json()['url']).query)['state'][0]
    client.cookies.clear();client.get('/api/session')
    assert 'Bağlantı isteğinin' in client.get('/api/oauth/x/callback',params={'state':state,'code':'fake'}).text
    with Session() as db: assert db.scalar(select(Credential)) is None
