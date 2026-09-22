import os,sys,tempfile,base64,secrets
from pathlib import Path
import pytest
root=Path(__file__).resolve().parents[2]
test_root=Path(tempfile.mkdtemp(prefix='akis-tests-',dir=root/'work'))
os.environ.update(DATABASE_URL='sqlite:///'+str(test_root/'test.db'),MEDIA_ROOT=str(test_root/'media'),CREDENTIAL_KEY=base64.b64encode(secrets.token_bytes(32)).decode(),QUEUE_MODE='test',LOCAL_MODE='true',APP_ORIGIN='http://localhost:5173')
sys.path.insert(0,str(root/'backend'))
from akis.db import Base,engine,Session
from akis.models import Credential,Content,ContentPlatform
from akis.security import encrypt

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
        with Session() as db:
            db.add(Credential(owner='local_seedy',platform=platform,access_token=encrypt('fake-token'),account_id='12345'))
            content=Content(created_by='local_seedy',body_text='Merhaba',platforms=[platform],asset_id=asset,options=options or {},status='processing')
            db.add(content);db.flush()
            d=ContentPlatform(content_id=content.id,platform=platform,recipient=recipient)
            db.add(d);db.commit();return d.id
    return create
