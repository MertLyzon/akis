import os,sys,tempfile,base64,secrets
from pathlib import Path
import pytest
from sqlalchemy.engine import make_url

def safe_test_database_url(value:str|None)->str|None:
    if not value: return None
    try:
        url=make_url(value)
        name=(url.database or '').lower()
        allowed=url.get_backend_name()=='postgresql' and (name.startswith('test_') or name.endswith(('_test','_tests')))
    except Exception:
        allowed=False
    if not allowed:
        # Do not echo the URL: it can contain credentials.
        raise pytest.UsageError('AKIS_TEST_DATABASE_URL must name a disposable PostgreSQL database prefixed test_ or suffixed _test/_tests. Production database names and other engines are refused.')
    return value

root=Path(__file__).resolve().parents[2]
(root/'work').mkdir(exist_ok=True)
test_runtime=tempfile.TemporaryDirectory(prefix='akis-tests-',dir=root/'work')
test_root=Path(test_runtime.name)
# AKIS_TEST_DATABASE_URL runs the suite against a throwaway PostgreSQL; tables are dropped after every test.
os.environ.update(DATABASE_URL=safe_test_database_url(os.environ.get('AKIS_TEST_DATABASE_URL')) or 'sqlite:///'+str(test_root/'test.db'),MEDIA_ROOT=str(test_root/'media'),CREDENTIAL_KEY=base64.b64encode(secrets.token_bytes(32)).decode(),QUEUE_MODE='test',LOCAL_MODE='true',APP_ORIGIN='http://localhost:5173',CLOUDINARY_URL='',ADMIN_PASSWORD_HASH='',BACKUP_DIR=str(test_root/'backups'))
sys.path.insert(0,str(root/'backend'))
from akis.db import Base,engine,Session
from akis.models import Credential,Content,ContentPlatform,Company,User
from akis.security import encrypt
from akis.access import ensure_bootstrap
from sqlalchemy import select

@pytest.fixture(scope='session',autouse=True)
def cleanup_test_runtime():
    yield
    # Release SQLite handles before removing only this run's own temporary files.
    # Existing work directories and any configured external database are untouched.
    engine.dispose()
    test_runtime.cleanup()

def company_id():
    ensure_bootstrap()
    with Session() as db: return db.scalar(select(Company.id))

def admin_id():
    ensure_bootstrap()
    with Session() as db: return db.scalar(select(User.id).where(User.is_system_admin==True))

@pytest.fixture(autouse=True)
def database():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)

@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from akis.main import app
    with TestClient(app,base_url='http://localhost:5173',headers={'Origin':'http://localhost:5173'}) as c:
        c.get('/api/session')
        yield c

@pytest.fixture
def job():
    def create(platform='x',asset=None,options=None,recipient=''):
        cid,uid=company_id(),admin_id()
        with Session() as db:
            db.add(Credential(company_id=cid,platform=platform,access_token=encrypt('fake-token'),account_id='12345'))
            content=Content(company_id=cid,created_by=uid,body_text='Merhaba',platforms=[platform],asset_id=asset,options=options or {},status='processing')
            db.add(content);db.flush()
            d=ContentPlatform(content_id=content.id,platform=platform,recipient=recipient)
            db.add(d);db.commit();return d.id
    return create
