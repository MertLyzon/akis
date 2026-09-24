"""Portable logical backups: every table to gzipped JSON, plus a restore check into a scratch database.

Tokens stay AES-GCM encrypted inside the backup; restoring them needs the same CREDENTIAL_KEY.
"""
import gzip, json, tempfile, time
from pathlib import Path
from sqlalchemy import create_engine, select, func, insert, text
from .config import settings
from .db import Base, engine
from . import models  # noqa: F401 — registers every table on Base.metadata

FORMAT=1

def backup_dir():
    path=Path(settings.backup_dir);path.mkdir(parents=True,exist_ok=True);return path

def create_backup(target_engine=None):
    source=target_engine or engine
    tables={}
    with source.connect() as conn:
        for table in Base.metadata.sorted_tables:
            tables[table.name]=[dict(row._mapping) for row in conn.execute(select(table))]
        try: revision=conn.execute(text('select version_num from alembic_version')).scalar()
        except Exception: revision=None
    stamp=time.strftime('%Y%m%d-%H%M%S')
    path=backup_dir()/f'akis-{stamp}.json.gz'
    payload={'format':FORMAT,'created_at':int(time.time()),'alembic_revision':revision,'counts':{k:len(v) for k,v in tables.items()},'tables':tables}
    with gzip.open(path,'wt',encoding='utf-8') as f: json.dump(payload,f,default=str)
    prune()
    return {'file':path.name,'size':path.stat().st_size,'counts':payload['counts']}

def prune():
    files=sorted(backup_dir().glob('akis-*.json.gz'))
    for old in files[:-settings.backup_keep]: old.unlink(missing_ok=True)

def list_backups():
    return [{'file':p.name,'size':p.stat().st_size,'created_at':int(p.stat().st_mtime)} for p in sorted(backup_dir().glob('akis-*.json.gz'),reverse=True)]

def load(path):
    path=Path(path)
    if not path.is_absolute(): path=backup_dir()/path.name
    with gzip.open(path,'rt',encoding='utf-8') as f: data=json.load(f)
    if data.get('format')!=FORMAT: raise ValueError('Unknown backup format')
    return data

def restore_into(data,target):
    """Insert every table into an empty database that already has the schema."""
    with target.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if conn.execute(select(func.count()).select_from(table)).scalar(): raise RuntimeError(f'Target table {table.name} is not empty')
            rows=data['tables'].get(table.name,[])
            # media_assets references itself (variant → source); insert sources first.
            rows=sorted(rows,key=lambda r: r.get('source_asset_id') is not None) if table.name=='media_assets' else rows
            if rows: conn.execute(insert(table),rows)

def verify_backup(path):
    """Restore into a throwaway SQLite database and compare row counts table by table."""
    data=load(path)
    with tempfile.TemporaryDirectory(dir=backup_dir()) as folder:
        scratch=create_engine('sqlite:///'+str(Path(folder)/'verify.db'))
        try:
            Base.metadata.create_all(scratch)
            restore_into(data,scratch)
            with scratch.connect() as conn:
                restored={t.name:conn.execute(select(func.count()).select_from(t)).scalar() for t in Base.metadata.sorted_tables}
        finally: scratch.dispose()
    expected={k:v for k,v in data['counts'].items()}
    mismatches={k:(expected.get(k,0),restored.get(k,0)) for k in set(expected)|set(restored) if expected.get(k,0)!=restored.get(k,0)}
    # A backup that lacks a table the schema has is incomplete, even if every count it does have matches.
    mismatches.update({k:('missing',restored.get(k,0)) for k in restored if k not in expected})
    return {'ok':not mismatches,'counts':restored,'mismatches':mismatches,'created_at':data['created_at']}
