from celery import Celery
from .config import settings

celery=Celery('akis',broker=settings.redis_url,include=['akis.tasks.x_publisher','akis.tasks.instagram_publisher','akis.tasks.tiktok_publisher','akis.tasks.whatsapp_sender','akis.jobs'])
celery.conf.update(task_serializer='json',accept_content=['json'],result_serializer='json',task_ignore_result=True,task_acks_late=True,worker_prefetch_multiplier=1,task_time_limit=600,broker_connection_retry_on_startup=True,broker_transport_options={'visibility_timeout':900},beat_schedule={'outbox':{'task':'akis.dispatch','schedule':10.0},'tokens':{'task':'akis.refresh_tokens','schedule':300.0}})
