"""Login throttling, account enumeration by timing, and the reverse-proxy trust boundary."""
import statistics,time
from sqlalchemy import delete,select
from akis.db import Session
from akis.models import AppSetting
from test_companies import add_member,ORIGIN

def fresh_client(ip):
    from fastapi.testclient import TestClient
    from akis.main import app
    return TestClient(app,base_url='http://localhost:5173',headers=ORIGIN,client=(ip,50000))

def clear_limits():
    with Session() as db:
        db.execute(delete(AppSetting).where(AppSetting.key.startswith('login')));db.commit()

def test_unknown_and_known_email_cost_the_same(client):
    add_member(client,'var@firma.com','viewer');clear_limits()
    samples={'var@firma.com':[],'yok@firma.com':[]};bodies=set()
    with fresh_client('10.9.0.1') as c:
        for i in range(120):
            for email in samples:
                start=time.perf_counter();r=c.post('/api/login',json={'email':email,'password':'yanlis-parola'})
                samples[email].append(time.perf_counter()-start)
                bodies.add((r.status_code,r.text))
            if i%3==2: clear_limits()  # measure the hashing path, not the 429 short-circuit
    known,unknown=(statistics.median(v) for v in samples.values())
    print(f'median known={known*1000:.1f}ms unknown={unknown*1000:.1f}ms mean known={statistics.mean(samples["var@firma.com"])*1000:.1f}ms unknown={statistics.mean(samples["yok@firma.com"])*1000:.1f}ms')
    assert len(bodies)==1,bodies  # identical status and message
    assert 0.8<known/unknown<1.25

def test_ip_and_account_limits_and_reset_on_success(client):
    password=add_member(client,'limit@firma.com','viewer')
    from test_companies import user_client
    with user_client('limit@firma.com',password):pass
    clear_limits()
    with fresh_client('10.8.0.1') as c:
        codes=[c.post('/api/login',json={'email':'limit@firma.com','password':'yanlis'}).status_code for _ in range(6)]
        assert codes==[401]*5+[429]
        # Even the right password waits out the lock for that IP+account.
        assert c.post('/api/login',json={'email':'limit@firma.com','password':password}).status_code==429
    with fresh_client('10.8.0.2') as c:
        for _ in range(3): c.post('/api/login',json={'email':'limit@firma.com','password':'yanlis'})
        assert c.post('/api/login',json={'email':'limit@firma.com','password':password}).status_code==200
    with Session() as db:
        keys=[k for k in db.scalars(select(AppSetting.key)) if k.startswith('login')]
    # Success clears this IP's counter and the account-wide counter; only the locked other IP remains.
    assert len(keys)==1

def asgi_client(trusted,peer):
    """The API app behind uvicorn's proxy-header middleware, as it runs in Docker."""
    from starlette.testclient import TestClient
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
    from akis.main import app
    return TestClient(ProxyHeadersMiddleware(app,trusted_hosts=trusted),base_url='http://localhost:5173',headers=ORIGIN,client=(peer,50000))

def test_forwarded_for_is_ignored_from_untrusted_peers(client):
    clear_limits()
    # Someone reaching port 8000 directly rotates X-Forwarded-For on every guess.
    with asgi_client('172.29.53.10','203.0.113.7') as direct:
        codes=[direct.post('/api/login',json={'email':'admin@akis.local','password':'x'},headers={'X-Forwarded-For':f'198.51.100.{i}'}).status_code for i in range(8)]
    assert codes[:5]==[401]*5 and set(codes[5:])=={429}

def test_forwarded_for_from_nginx_gives_each_client_its_own_limit(client):
    clear_limits()
    with asgi_client('172.29.53.10','172.29.53.10') as nginx:
        codes=[nginx.post('/api/login',json={'email':'admin@akis.local','password':'x'},headers={'X-Forwarded-For':'198.51.100.1'}).status_code for _ in range(6)]
        assert codes==[401]*5+[429]
        # Another real client behind the same nginx is not locked out by the first one.
        assert nginx.post('/api/login',json={'email':'admin@akis.local','password':'x'},headers={'X-Forwarded-For':'198.51.100.2'}).status_code==401

def test_distributed_spoofed_bruteforce_hits_account_limit(client):
    clear_limits();codes=[]
    with asgi_client('172.29.53.10','172.29.53.10') as nginx:
        for i in range(25):
            codes.append(nginx.post('/api/login',json={'email':'admin@akis.local','password':'x'},headers={'X-Forwarded-For':f'198.51.100.{i}'}).status_code)
    assert codes[:20]==[401]*20 and set(codes[20:])=={429}

def test_nginx_overwrites_client_supplied_forwarded_for():
    from pathlib import Path
    conf=(Path(__file__).resolve().parents[2]/'deploy'/'nginx.conf').read_text()
    assert 'proxy_set_header X-Forwarded-For $remote_addr;' in conf and '$proxy_add_x_forwarded_for' not in conf
    compose=(Path(__file__).resolve().parents[2]/'compose.yaml').read_text()
    assert 'FORWARDED_ALLOW_IPS: 172.29.53.10' in compose and 'ipv4_address: 172.29.53.10' in compose
    assert '"*"' not in (Path(__file__).resolve().parents[2]/'backend'/'Dockerfile').read_text()
