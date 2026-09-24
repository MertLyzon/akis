"""Backups from the command line.

  python scripts/backup.py create              # dump every table to backups/akis-*.json.gz and verify it
  python scripts/backup.py verify FILE         # restore into a throwaway SQLite database and compare row counts
  python scripts/backup.py list
  python scripts/backup.py restore FILE URL    # load into an EMPTY database that already has the schema
                                               # (run: alembic -c backend/alembic.ini upgrade head against URL first)
"""
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'backend'))
from akis.backup import create_backup,verify_backup,list_backups,load,restore_into

def main(args):
    if not args or args[0] not in ('create','verify','list','restore'): print(__doc__);return 2
    if args[0]=='create':
        result=create_backup();check=verify_backup(result['file'])
        print(json.dumps({**result,'verified':check['ok'],'mismatches':check['mismatches']},indent=2));return 0 if check['ok'] else 1
    if args[0]=='verify':
        check=verify_backup(args[1]);print(json.dumps(check,indent=2));return 0 if check['ok'] else 1
    if args[0]=='list':
        for b in list_backups(): print(b['file'],b['size'])
        return 0
    from sqlalchemy import create_engine
    url=args[2]
    for prefix in ('postgres://','postgresql://'):
        if url.startswith(prefix): url='postgresql+psycopg://'+url[len(prefix):]
    restore_into(load(args[1]),create_engine(url));print('Restored',args[1]);return 0

if __name__=='__main__': raise SystemExit(main(sys.argv[1:]))
