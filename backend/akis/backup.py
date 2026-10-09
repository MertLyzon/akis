"""Portable, verified backups with optional private Cloudinary persistence.

Every table is written to gzipped JSON. Tokens remain AES-GCM encrypted and
restoring them requires the same CREDENTIAL_KEY. A backup is never promoted or
allowed to prune an older copy until a scratch-database restore has succeeded.
"""
import gzip, json, logging, tempfile, time
from pathlib import Path
from sqlalchemy import create_engine, select, func, insert, text
from .config import settings
from .db import Base, engine
from . import models, storage  # noqa: F401 — models registers every table.

FORMAT=1
_remote_cache={'at':0.0,'rows':[]}
log=logging.getLogger(__name__)

def backup_dir():
    path=Path(settings.backup_dir);path.mkdir(parents=True,exist_ok=True)
    try:
        path.chmod(0o700)
        for existing in path.glob('akis-*.json.gz'): existing.chmod(0o600)
    except OSError: pass
    return path

def create_backup(target_engine=None):
    """Create a local candidate. Use create_verified_backup for scheduled/admin backups."""
    source=target_engine or engine
    tables={}
    with source.connect() as conn:
        for table in Base.metadata.sorted_tables:
            tables[table.name]=[dict(row._mapping) for row in conn.execute(select(table))]
        try: revision=conn.execute(text('select version_num from alembic_version')).scalar()
        except Exception: revision=None
    stamp=time.strftime('%Y%m%d-%H%M%S')
    path=backup_dir()/f'akis-{stamp}.json.gz'
    payload={'format':FORMAT,'created_at':int(time.time()),'alembic_revision':revision,'counts':{key:len(value) for key,value in tables.items()},'tables':tables}
    with gzip.open(path,'wt',encoding='utf-8') as output: json.dump(payload,output,default=str)
    try: path.chmod(0o600)
    except OSError: pass
    return {'file':path.name,'size':path.stat().st_size,'counts':payload['counts'],'location':'local'}

def _local_backups():
    return [{'file':path.name,'size':path.stat().st_size,'created_at':int(path.stat().st_mtime),'location':'local'} for path in sorted(backup_dir().glob('akis-*.json.gz'),reverse=True)]

def _remote_backups(force=False):
    if not storage.backup_enabled(): return []
    if not force and time.monotonic()-_remote_cache['at']<60: return _remote_cache['rows']
    rows=storage.list_remote_backups()
    _remote_cache.update(at=time.monotonic(),rows=rows)
    return rows

def list_backups():
    """Merge local cache and durable remote copies without duplicating rows."""
    local={row['file']:row for row in _local_backups()}
    try: remote={row['file']:row for row in _remote_backups()}
    except Exception: remote={}
    result=[]
    for name in sorted(set(local)|set(remote),reverse=True):
        row={**(remote.get(name) or local[name])}
        if name in local and name in remote: row['location']='both'
        result.append(row)
    return result

def _local_path(name): return backup_dir()/Path(name).name

def _materialized(path):
    candidate=Path(path)
    if candidate.is_absolute() and candidate.exists(): return candidate,None
    local=_local_path(candidate.name)
    if local.exists(): return local,None
    if not storage.backup_enabled(): raise FileNotFoundError(candidate.name)
    folder=Path(tempfile.mkdtemp(prefix='akis-backup-',dir=backup_dir()))
    target=folder/candidate.name
    try: storage.download_backup(candidate.name,target)
    except Exception:
        import shutil
        shutil.rmtree(folder,ignore_errors=True);raise
    return target,folder

def load(path):
    materialized,folder=_materialized(path)
    try:
        with gzip.open(materialized,'rt',encoding='utf-8') as source: data=json.load(source)
    finally:
        if folder:
            import shutil
            shutil.rmtree(folder,ignore_errors=True)
    if data.get('format')!=FORMAT: raise ValueError('Unknown backup format')
    return data

def restore_into(data,target):
    with target.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if conn.execute(select(func.count()).select_from(table)).scalar(): raise RuntimeError(f'Target table {table.name} is not empty')
            rows=data['tables'].get(table.name,[])
            rows=sorted(rows,key=lambda row:row.get('source_asset_id') is not None) if table.name=='media_assets' else rows
            if rows: conn.execute(insert(table),rows)

def verify_backup(path):
    data=load(path)
    with tempfile.TemporaryDirectory(dir=backup_dir()) as folder:
        scratch=create_engine('sqlite:///'+str(Path(folder)/'verify.db'))
        try:
            Base.metadata.create_all(scratch)
            restore_into(data,scratch)
            with scratch.connect() as conn:
                restored={table.name:conn.execute(select(func.count()).select_from(table)).scalar() for table in Base.metadata.sorted_tables}
        finally: scratch.dispose()
    expected={key:value for key,value in data['counts'].items()}
    mismatches={key:(expected.get(key,0),restored.get(key,0)) for key in set(expected)|set(restored) if expected.get(key,0)!=restored.get(key,0)}
    mismatches.update({key:('missing',restored.get(key,0)) for key in restored if key not in expected})
    return {'ok':not mismatches,'counts':restored,'mismatches':mismatches,'created_at':data['created_at']}

def prune():
    local=sorted(backup_dir().glob('akis-*.json.gz'),reverse=True)
    for old in local[max(1,settings.backup_keep):]: old.unlink(missing_ok=True)
    if not storage.backup_enabled(): return
    try:
        remote=_remote_backups(force=True)
        for old in remote[max(1,settings.backup_keep):]: storage.delete_backup(old['file'])
        _remote_cache['at']=0.0
    except Exception:
        # The new verified remote copy already exists. A rate-limited cleanup
        # must not turn that successful backup into a failed backup job.
        log.warning('Remote backup retention cleanup will be retried later')

def create_verified_backup(target_engine=None):
    result=create_backup(target_engine)
    path=_local_path(result['file'])
    check=verify_backup(path)
    if not check['ok']:
        path.unlink(missing_ok=True)
        raise RuntimeError(f"Backup verification failed: {check['mismatches']}")
    if storage.backup_enabled():
        storage.upload_backup(path)
        result['location']='both'
        _remote_cache['at']=0.0
    prune()
    return {**result,'verified':True,'mismatches':{}}
