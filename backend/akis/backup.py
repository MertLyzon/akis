"""Portable, encrypted and verified backups with private cloud persistence.

New archives are compressed and then authenticated-encrypted with a key derived
from CREDENTIAL_KEY. Legacy v1 gzip archives remain readable for restores. A
backup is never promoted or allowed to prune an older copy until a scratch-
database restore has succeeded.
"""
import gzip, json, logging, secrets, tempfile, time
from pathlib import Path
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import create_engine, select, func, insert, text
from .config import settings
from .db import Base, engine
from . import models, storage  # noqa: F401 — models registers every table.
from .security import raw_key

FORMAT=2
LEGACY_FORMAT=1
MAGIC=b'AKISBACKUP\x02\n'
_remote_cache={'at':0.0,'rows':[]}
log=logging.getLogger(__name__)

def _backup_key():
    return HKDF(algorithm=hashes.SHA256(),length=32,salt=None,info=b'akis-backup-v2').derive(raw_key())

def _encode(payload):
    plain=json.dumps(payload,default=str,ensure_ascii=False,separators=(',',':')).encode()
    compressed=gzip.compress(plain,compresslevel=9)
    nonce=secrets.token_bytes(12)
    return MAGIC+nonce+AESGCM(_backup_key()).encrypt(nonce,compressed,MAGIC)

def _decode(raw):
    if raw.startswith(MAGIC):
        nonce=raw[len(MAGIC):len(MAGIC)+12]
        ciphertext=raw[len(MAGIC)+12:]
        if len(nonce)!=12 or len(ciphertext)<16: raise ValueError('Encrypted backup is truncated')
        try: compressed=AESGCM(_backup_key()).decrypt(nonce,ciphertext,MAGIC)
        except InvalidTag as error: raise ValueError('Backup authentication failed') from error
        try: return json.loads(gzip.decompress(compressed))
        except (gzip.BadGzipFile,EOFError,json.JSONDecodeError,UnicodeDecodeError) as error: raise ValueError('Encrypted backup payload is invalid') from error
    # Backward compatibility for backups created before full-archive encryption.
    try: return json.loads(gzip.decompress(raw))
    except (gzip.BadGzipFile,EOFError,json.JSONDecodeError,UnicodeDecodeError) as error: raise ValueError('Backup archive is invalid') from error

def backup_dir():
    path=Path(settings.backup_dir);path.mkdir(parents=True,exist_ok=True)
    try:
        path.chmod(0o700)
        for existing in path.iterdir():
            if storage.BACKUP_NAME.fullmatch(existing.name): existing.chmod(0o600)
    except OSError: pass
    return path

def _backup_files():
    return sorted((path for path in backup_dir().iterdir() if path.is_file() and storage.BACKUP_NAME.fullmatch(path.name)),reverse=True)

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
    path=backup_dir()/f'akis-{stamp}.json.gz.enc'
    payload={'format':FORMAT,'created_at':int(time.time()),'alembic_revision':revision,'counts':{key:len(value) for key,value in tables.items()},'tables':tables}
    pending=path.with_name('.'+path.name+'.pending')
    pending.write_bytes(_encode(payload))
    try: pending.chmod(0o600)
    except OSError: pass
    pending.replace(path)
    return {'file':path.name,'size':path.stat().st_size,'counts':payload['counts'],'location':'local'}

def _local_backups():
    return [{'file':path.name,'size':path.stat().st_size,'created_at':int(path.stat().st_mtime),'location':'local'} for path in _backup_files()]

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
        data=_decode(materialized.read_bytes())
    finally:
        if folder:
            import shutil
            shutil.rmtree(folder,ignore_errors=True)
    if data.get('format') not in (LEGACY_FORMAT,FORMAT): raise ValueError('Unknown backup format')
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
    local=_backup_files()
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
