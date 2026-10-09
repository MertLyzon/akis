import shutil
from pathlib import Path

from akis import backup,storage
from akis.config import settings


def reset_cache(): backup._remote_cache.update(at=0.0,rows=[])


def test_verified_backup_uploads_only_after_restore_check(client,tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'backup_dir',str(tmp_path))
    monkeypatch.setattr(storage,'backup_enabled',lambda:True)
    uploaded=[]
    monkeypatch.setattr(storage,'upload_backup',lambda path:uploaded.append(Path(path).name))
    monkeypatch.setattr(storage,'list_remote_backups',lambda:[])
    result=backup.create_verified_backup()
    assert result['verified'] and result['location']=='both'
    assert uploaded==[result['file']]
    assert backup.verify_backup(result['file'])['ok']


def test_failed_verification_is_never_uploaded_or_retained(client,tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'backup_dir',str(tmp_path))
    monkeypatch.setattr(storage,'backup_enabled',lambda:True)
    monkeypatch.setattr(backup,'verify_backup',lambda path:{'ok':False,'mismatches':{'users':(1,0)}})
    monkeypatch.setattr(storage,'upload_backup',lambda path:(_ for _ in ()).throw(AssertionError('must not upload')))
    try:
        backup.create_verified_backup()
    except RuntimeError as error:
        assert 'verification failed' in str(error)
    else:
        raise AssertionError('verification failure must abort the backup')
    assert list(tmp_path.glob('akis-*.json.gz'))==[]


def test_remote_backup_can_be_verified_after_local_copy_is_lost(client,tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'backup_dir',str(tmp_path))
    monkeypatch.setattr(storage,'backup_enabled',lambda:False)
    result=backup.create_verified_backup();source=tmp_path/result['file']
    durable=tmp_path/'durable-copy';shutil.copyfile(source,durable);source.unlink()
    monkeypatch.setattr(storage,'backup_enabled',lambda:True)
    monkeypatch.setattr(storage,'download_backup',lambda name,target:shutil.copyfile(durable,target))
    assert backup.verify_backup(result['file'])['ok']
    assert not source.exists()


def test_backup_listing_merges_local_and_remote_locations(client,tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'backup_dir',str(tmp_path))
    monkeypatch.setattr(storage,'backup_enabled',lambda:False)
    result=backup.create_verified_backup();name=result['file'];reset_cache()
    monkeypatch.setattr(storage,'backup_enabled',lambda:True)
    monkeypatch.setattr(storage,'list_remote_backups',lambda:[{'file':name,'size':99,'created_at':10,'location':'remote'}])
    rows=backup.list_backups()
    assert rows[0]['file']==name and rows[0]['location']=='both'


def test_cloudinary_backup_upload_is_private_raw(tmp_path,monkeypatch):
    path=tmp_path/'akis-20261009-120000.json.gz';path.write_bytes(b'archive')
    calls=[]
    monkeypatch.setattr('cloudinary.uploader.upload',lambda *args,**kwargs:calls.append((args,kwargs)) or {'bytes':7})
    result=storage.upload_backup(path)
    assert result['file']==path.name
    args,options=calls[0]
    assert args==(str(path),)
    assert options['resource_type']=='raw' and options['type']=='private'
    assert options['public_id']=='akis-backups/'+path.name
