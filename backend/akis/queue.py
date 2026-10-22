from celery import Celery
from celery.schedules import crontab
from celery.signals import beat_init, worker_ready
from .config import settings
from .health import start_heartbeat

celery=Celery('akis',broker=settings.redis_url,include=['akis.tasks.x_publisher','akis.tasks.instagram_publisher','akis.tasks.tiktok_publisher','akis.tasks.whatsapp_sender','akis.jobs'])
# Neon Free suspends compute after five idle minutes. Keep recovery/maintenance
# sweeps just beyond that window so an idle app can actually let the database sleep.
# User-triggered work is enqueued directly; missed broker tasks are recovered by
# the next sweep (at most six minutes later).
IDLE_DATABASE_SWEEP_MINUTES=6
IDLE_DATABASE_SWEEP_SECONDS=IDLE_DATABASE_SWEEP_MINUTES*60
IDLE_DATABASE_SWEEP=crontab(minute=f'*/{IDLE_DATABASE_SWEEP_MINUTES}')
beat_schedule={'outbox':{'task':'akis.dispatch','schedule':IDLE_DATABASE_SWEEP},'tokens':{'task':'akis.refresh_tokens','schedule':IDLE_DATABASE_SWEEP}}
if settings.backup_interval_days>0:
    beat_schedule['backup']={'task':'akis.backup','schedule':settings.backup_interval_days*86400.0}
celery.conf.update(task_serializer='json',accept_content=['json'],result_serializer='json',task_ignore_result=True,task_acks_late=True,worker_prefetch_multiplier=1,task_time_limit=600,broker_connection_retry_on_startup=True,broker_transport_options={'visibility_timeout':900},beat_schedule=beat_schedule)

@worker_ready.connect
def worker_heartbeat(**_kwargs): start_heartbeat('worker')

@beat_init.connect
def beat_heartbeat(**_kwargs): start_heartbeat('beat')
