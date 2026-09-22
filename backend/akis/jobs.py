import importlib, logging, time
from sqlalchemy import select, update
from .queue import celery
from .db import Session
from .models import Content,ContentPlatform,MediaAsset,Credential,Broadcast,now
from .errors import PlatformError
from .media import process_asset,variant_for
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
        try:
            asset=db.get(MediaAsset,content.asset_id) if content.asset_id else None
            if asset:
                if asset.status=='failed': raise PlatformError(delivery.platform,'media_failed',asset.error)
                if asset.status!='ready': raise Waiting(10,'Medya hazırlanıyor.')
                asset=variant_for(db,asset,delivery.platform)
                if asset.note: delivery.progress={**delivery.progress,'media_note':asset.note};db.commit()
            token=token_for(content.created_by,delivery.platform)
            credential=db.scalar(select(Credential).where(Credential.owner==content.created_by,Credential.platform==delivery.platform))
            publisher=importlib.import_module('akis.tasks.'+MODULES[delivery.platform])
            publisher.publish(Context(db,delivery,content,credential,token,asset))
        except Waiting as wait:
            if content.created_at<now()-86400:
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
        update_content(db,content.id)

def recover_stale(db):
    stale=list(db.scalars(select(ContentPlatform).where(ContentPlatform.status=='sending',ContentPlatform.updated_at<now()-900)))
    for row in stale:
        if row.final_request_started:
            row.status='unknown';row.error_code='worker_interrupted';row.error_message='Gönderim sırasında işlem kesildi. Tekrar göndermeden önce platform hesabını kontrol et.'
        elif row.retry_count<3:
            row.status='pending';row.retry_count+=1;row.next_attempt_at=now()
        else: row.status='failed';row.error_message='İşlem üç kez kesildi. Medyanı ve sunucu durumunu kontrol et.'
        row.updated_at=now()
    db.execute(update(MediaAsset).where(MediaAsset.status=='converting',MediaAsset.updated_at<now()-900).values(status='failed',error='Medya işleme kesildi. Dosyayı yeniden yükle.'))
    db.commit()
    for row in stale: update_content(db,row.content_id)

@celery.task(name='akis.process_media')
def process_media(identifier): process_asset(identifier)

@celery.task(name='akis.refresh_tokens')
def refresh_tokens(): refresh_due()

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
    last_refresh=0
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
            if time.monotonic()-last_refresh>300: refresh_due();last_refresh=time.monotonic()
        except Exception: log.error('Local background worker paused; retrying next cycle')
