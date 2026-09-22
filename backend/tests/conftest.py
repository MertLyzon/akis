import os,sys,tempfile,base64,secrets
from pathlib import Path
import pytest
root=Path(__file__).resolve().parents[2]
test_root=Path(tempfile.mkdtemp(prefix='akis-tests-',dir=root/'work'))
os.environ.update(DATABASE_URL='sqlite:///'+str(test_root/'test.db'),MEDIA_ROOT=str(test_root/'media'),CREDENTIAL_KEY=base64.b64encode(secrets.token_bytes(32)).decode(),QUEUE_MODE='test',LOCAL_MODE='true',APP_ORIGIN='http://localhost:5173',CLOUDINARY_URL='',ADMIN_PASSWORD_HASH='',BACKUP_DIR=str(test_root/'backups'))
sys.path.insert(0,str(root/'backend'))
from akis.db import Base,engine,Session
from akis.models import Credential,Content,ContentPlatform,Company,User
from akis.security import encrypt
from akis.access import ensure_bootstrap
from sqlalchemy import select

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
