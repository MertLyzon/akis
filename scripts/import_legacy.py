"""One-time, read-only import of the first version's local D1 database."""
import json,sqlite3,sys
from datetime import datetime
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'backend'))
from akis.db import Session
from akis.models import Credential,Content,ContentPlatform,AppSetting
from sqlalchemy import select

files=[p for p in (root/'.wrangler/state/v3/d1').rglob('*.sqlite') if p.name!='metadata.sqlite']
if not files: print('No legacy database; nothing to import.');raise SystemExit(0)
counts={'connections':0,'posts':0,'deliveries':0}
with Session() as db:
    if db.get(AppSetting,'legacy_imported'): print('Legacy data already imported.');raise SystemExit(0)
    old=sqlite3.connect(files[0].as_uri()+'?mode=ro',uri=True);old.row_factory=sqlite3.Row
    for c in old.execute('select * from connections'):
        if not db.scalar(select(Credential).where(Credential.owner==c['owner'],Credential.platform==c['platform'])):
            db.add(Credential(owner=c['owner'],platform=c['platform'],access_token=c['token'],account_id=c['account'],account_label='Önceki sürümden aktarıldı'));counts['connections']+=1
    for p in old.execute('select * from posts'):
        if db.get(Content,p['id']): continue
        stamp=int(datetime.fromisoformat(p['created'].replace('Z','+00:00')).timestamp())
        db.add(Content(id=p['id'],created_by=p['owner'],body_text=p['text'],created_at=stamp,platforms=json.loads(p['platforms']),status='draft' if p['status']=='draft' else 'completed',options={'recipients':[p['recipient']] if p['recipient'] else [],'template':p['template'],'language':p['language'],'legacy_media_url':p['media']},fingerprint='legacy'))
        db.flush();counts['posts']+=1
        for d in old.execute('select * from deliveries where post_id=?',(p['id'],)):
            # Never replay old posts or trigger real accounts during migration.
            status='unknown' if d['status'] in ('pending','sending') else d['status']
            db.add(ContentPlatform(id=d['id'],content_id=p['id'],platform=d['platform'],status=status,error_message=d['error'],external_post_id=d['external_id']));counts['deliveries']+=1
    db.add(AppSetting(key='legacy_imported',value='true'));db.commit();old.close()
print('Legacy import complete:',counts)
