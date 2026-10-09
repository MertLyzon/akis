import importlib, json, logging, time
from sqlalchemy import select, update, delete, or_
from .queue import celery
from .db import Session
from .models import Content,ContentPlatform,MediaAsset,Credential,Broadcast,DeliveryAttempt,OAuthState,AppSetting,Invitation,now
from .errors import PlatformError
from .media import process_asset,variant_for,path_for
from .tokens import token_for,refresh_due
from .tasks.common import Context,Waiting
from .config import settings

log=logging.getLogger(__name__)
MODULES={'x':'x_publisher','instagram':'instagram_publisher','tiktok':'tiktok_publisher','whatsapp':'whatsapp_sender'}

def update_content(db,content_id):
    rows=list(db.scalars(select(ContentPlatform).where(ContentPlatform.content_id==content_id)))
    c=db.get(Content,content_id)
    if not c or not rows: return
    c.status='processing' if any(r.status in ('pending','sending') for r in rows) else ('attention' if any(r.status in ('failed','unknown') for r in rows) else 'completed')
    b=db.scalar(select(Broadcast).where(Broadcast.content_id==content_id))
    if b:
        wa=[r for r in rows if r.platform=='whatsapp'];b.status='completed' if all(r.status in ('sent','submitted') for r in wa) else c.status
        if b.status=='completed': b.sent_at=now()
    db.commit()

def run_delivery(identifier):
    with Session() as db:
        changed=db.execute(update(ContentPlatform).where(ContentPlatform.id==identifier,ContentPlatform.status=='pending',ContentPlatform.next_attempt_at<=now()).values(status='sending',updated_at=now())).rowcount
        db.commit()
        if not changed: return
        delivery=db.get(ContentPlatform,identifier);content=db.get(Content,delivery.content_id)
        # Polling a platform that is still processing (Instagram/TikTok/X, every 10–60 s) continues the
        # same attempt instead of adding a row per poll; a day of waiting would otherwise be thousands of rows.
        attempt=db.scalar(select(DeliveryAttempt).where(DeliveryAttempt.delivery_id==identifier).order_by(DeliveryAttempt.started_at.desc()).limit(1))
        if attempt and attempt.outcome=='waiting': attempt.outcome='running';attempt.finished_at=None
        else: attempt=DeliveryAttempt(delivery_id=identifier,stage='start');db.add(attempt)
        db.commit();attempt_id=attempt.id
        try:
            asset=db.get(MediaAsset,content.asset_id) if content.asset_id else None
            if asset:
                if asset.status=='failed': raise PlatformError(delivery.platform,'media_failed',asset.error)
                if asset.status!='ready': raise Waiting(10,'Medya hazırlanıyor.')
                asset=variant_for(db,asset,delivery.platform)
                if asset.note: delivery.progress={**delivery.progress,'media_note':asset.note};db.commit()
            token=token_for(content.company_id,delivery.platform)
            credential=db.scalar(select(Credential).where(Credential.company_id==content.company_id,Credential.platform==delivery.platform))
            publisher=importlib.import_module('akis.tasks.'+MODULES[delivery.platform])
            publisher.publish(Context(db,delivery,content,credential,token,asset))
        except Waiting as wait:
            # Measured from when the post became due, so a post scheduled weeks ahead is not timed out early.
            if max(content.created_at,content.scheduled_at or 0,content.approved_at or 0)<now()-86400:
                delivery.status='failed';delivery.error_code='processing_timeout';delivery.error_message='Medya bir gün içinde hazırlanamadı. Dosyayı ve platform durumunu kontrol et.'
            else:
                delivery.status='pending';delivery.next_attempt_at=now()+wait.seconds;delivery.error_message=wait.message
            delivery.updated_at=now();db.commit()
        except PlatformError as exc:
            delivery.error_code=exc.code;delivery.error_message=exc.message;delivery.updated_at=now()
            if exc.ambiguous:
                delivery.status='unknown';delivery.error_message+=' Yeniden göndermeden önce hesabını kontrol et; yinelenen paylaşım oluşturmamak için otomatik tekrar durduruldu.'
            elif exc.retryable and delivery.retry_count<3:
                delivery.retry_count+=1;delivery.status='pending';delivery.next_attempt_at=now()+min(600,30*2**(delivery.retry_count-1));delivery.final_request_started=False
            else:
                delivery.status='failed';delivery.final_request_started=False
            db.commit()
        except Exception:
            db.rollback();delivery=db.get(ContentPlatform,identifier)
            delivery.status='unknown' if delivery.final_request_started else 'failed';delivery.error_code='internal';delivery.error_message='İşlem tamamlanamadı. Gönderim geçmişini kontrol et.';delivery.updated_at=now();db.commit()
            log.error('Delivery %s stopped with internal error',identifier)
        finish_attempt(db,attempt_id,delivery)
        update_content(db,content.id)

def finish_attempt(db,attempt_id,delivery):
    a=db.get(DeliveryAttempt,attempt_id)
    if not a: return
    a.finished_at=now();a.error_code=delivery.error_code;a.error_message=delivery.error_message
    progress=delivery.progress or {}
    a.stage='publish' if delivery.external_post_id or delivery.status=='unknown' else ('media_upload' if any(k in progress for k in ('media_id','container','publish_id')) else 'prepare')
    a.outcome={'pending':'retry' if delivery.error_code else 'waiting'}.get(delivery.status,delivery.status)
    db.commit()

def recover_stale(db):
    stale=list(db.scalars(select(ContentPlatform).where(ContentPlatform.status=='sending',ContentPlatform.updated_at<now()-900)))
    for row in stale:
        if row.final_request_started:
            row.status='unknown';row.error_code='worker_interrupted';row.error_message='Gönderim sırasında işlem kesildi. Tekrar göndermeden önce platform hesabını kontrol et.'
        elif row.retry_count<3:
            row.status='pending';row.retry_count+=1;row.next_attempt_at=now()
        else: row.status='failed';row.error_message='İşlem üç kez kesildi. Medyanı ve sunucu durumunu kontrol et.'
        row.updated_at=now()
    interrupted=list(db.scalars(select(MediaAsset).where(MediaAsset.status=='converting',MediaAsset.updated_at<now()-900)))
    for a in interrupted:
        a.status='failed';a.error='Medya işleme kesildi. Dosyayı yeniden yükle.';a.updated_at=now()
    db.commit()
    for a in interrupted:
        for key in {a.storage_key,a.id+'.jpg',a.id+'.mp4'}:
            try: path_for(key).unlink(missing_ok=True)
            except (OSError,ValueError): pass
    for row in stale: update_content(db,row.content_id)

@celery.task(name='akis.process_media')
def process_media(identifier): process_asset(identifier)

def housekeeping():
    """Drop rows that only matter for minutes: used/expired OAuth states and lapsed login throttles."""
    with Session() as db:
        db.execute(delete(OAuthState).where(OAuthState.expires_at<now()-3600))
        # Used, revoked or expired invitations stay 30 days for the admin's reference, then go.
        db.execute(delete(Invitation).where(Invitation.expires_at<now()-30*86400))
        for row in db.scalars(select(AppSetting).where(or_(AppSetting.key.startswith('login:'),AppSetting.key.startswith('login-account:')))):
            try: lapsed=json.loads(row.value).get('until',0)<=now()
            except (ValueError,AttributeError): lapsed=True
            if lapsed: db.delete(row)
        db.commit()

@celery.task(name='akis.refresh_tokens')
def refresh_tokens():
    housekeeping();refresh_due()

@celery.task(name='akis.backup')
def scheduled_backup():
    from .backup import create_verified_backup
    create_verified_backup()

def ensure_local_daily_backup():
    """Create a verified backup when local mode has no backup from the last 24 hours."""
    from .backup import create_verified_backup, list_backups
    backups=list_backups()
    if backups and backups[0]['created_at']>=int(time.time())-86400: return None
    return create_verified_backup()

def enqueue_content(content_id):
    if settings.queue_mode!='celery': return
    with Session() as db:
        jobs=list(db.execute(select(ContentPlatform.id,ContentPlatform.platform).where(ContentPlatform.content_id==content_id,ContentPlatform.status=='pending')))
    for identifier,platform in jobs:
        try:
            module=importlib.import_module('akis.tasks.'+MODULES[platform])
            getattr(module,'send_to_'+platform).delay(identifier)
        except Exception:
            # The committed outbox remains pending and Beat will recover it.
            log.warning('Broker unavailable; content %s remains in outbox',content_id)
            return

@celery.task(name='akis.dispatch')
def dispatch():
    with Session() as db:
        recover_stale(db)
        media_ids=list(db.scalars(select(MediaAsset.id).where(MediaAsset.status=='processing').limit(20)))
        jobs=list(db.execute(select(ContentPlatform.id,ContentPlatform.platform).where(ContentPlatform.status=='pending',ContentPlatform.next_attempt_at<=now()).limit(100)))
    for identifier in media_ids: process_media.delay(identifier)
    for identifier,platform in jobs: celery.send_task('akis.send_to_'+platform,args=[identifier])

def local_worker(stop):
    # Development fallback when Docker/Redis are unavailable; uses the same durable rows and publishers.
    last_refresh=0;last_backup_check=0
    while not stop.wait(2):
        try:
            with Session() as db:
                recover_stale(db)
                media_ids=list(db.scalars(select(MediaAsset.id).where(MediaAsset.status=='processing').limit(3)))
                ids=list(db.scalars(select(ContentPlatform.id).where(ContentPlatform.status=='pending',ContentPlatform.next_attempt_at<=now()).limit(10)))
            for identifier in media_ids: process_asset(identifier)
            for identifier in ids:
                if stop.is_set(): return
                run_delivery(identifier)
            if time.monotonic()-last_refresh>300: housekeeping();refresh_due();last_refresh=time.monotonic()
            if time.monotonic()-last_backup_check>300:
                ensure_local_daily_backup();last_backup_check=time.monotonic()
        except Exception: log.error('Local background worker paused; retrying next cycle')
