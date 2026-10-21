from sqlalchemy import select
from akis.db import Session
from akis.models import Company,MediaAsset


def test_tagged_library_filters_before_limit_and_serializes_only_the_visible_page(client,monkeypatch):
    import akis.main as main
    with Session() as db:
        company_id=db.scalar(select(Company.id))
        db.add_all([
            MediaAsset(id=f'limit-{index}',company_id=company_id,filename=f'limit-{index}.png',
                       storage_key=f'limit-{index}.png',mime_type='image/png',status='ready',
                       tags=['wanted'] if index%2 else ['other'],created_at=1000+index)
            for index in range(1200)
        ])
        db.commit()
    serialized=[]
    original=main.asset_json
    def tracked(asset,db):
        serialized.append(asset.id)
        return original(asset,db)
    monkeypatch.setattr(main,'asset_json',tracked)
    response=client.get('/api/media',params={'tag':'wanted'})
    assert response.status_code==200
    expected=[f'limit-{index}' for index in range(1199,200,-2)]
    assert [item['id'] for item in response.json()['items']]==expected
    assert serialized==expected


def test_tagged_library_does_not_serialize_nonmatching_assets(client,monkeypatch):
    import akis.main as main
    with Session() as db:
        company_id=db.scalar(select(Company.id))
        db.add(MediaAsset(company_id=company_id,filename='other.png',storage_key='other.png',
                          mime_type='image/png',status='ready',tags=['other']))
        db.commit()
    def unexpected(*args):
        raise AssertionError('Nonmatching asset serialized')
    monkeypatch.setattr(main,'asset_json',unexpected)
    response=client.get('/api/media',params={'tag':'wanted'})
    assert response.status_code==200
    assert response.json()['items']==[]


def test_library_has_a_stable_order_when_uploads_share_the_same_timestamp(client):
    with Session() as db:
        company_id=db.scalar(select(Company.id))
        db.add_all([
            MediaAsset(id=identifier,company_id=company_id,filename=identifier+'.png',
                       storage_key=identifier+'.png',mime_type='image/png',status='ready',
                       tags=['wanted'],created_at=1000)
            for identifier in ['same-a','same-c','same-b']
        ])
        db.commit()
    for params in ({},{'tag':'wanted'}):
        response=client.get('/api/media',params=params)
        assert response.status_code==200
        assert [item['id'] for item in response.json()['items']]==['same-c','same-b','same-a']
