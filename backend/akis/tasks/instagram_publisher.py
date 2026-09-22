from ..queue import celery
from ..platform_http import request
from ..media import media_url
from ..config import settings
from ..errors import PlatformError
from .common import Waiting

def publish(ctx):
    base=f'https://graph.instagram.com/{settings.graph_version}/'
    container=ctx.progress.get('container')
    if not container:
        if not ctx.asset: raise PlatformError('instagram','media','Instagram için bir görsel veya video yükle.')
        url=media_url(ctx.asset,ctx.db,public=True)
        body={'caption':ctx.content.body_text}
        if ctx.asset.mime_type.startswith('video'): body.update(media_type='REELS',video_url=url)
        else: body['image_url']=url
        r=request('instagram','POST',base+ctx.credential.account_id+'/media',ctx.token,json=body)
        container=r.get('id')
        if not container: raise PlatformError('instagram','container','Instagram medya hazırlığını başlatamadı.',retryable=True)
        ctx.checkpoint(container=str(container))
    r=request('instagram','GET',base+str(container),ctx.token,params={'fields':'status_code'})
    if r.get('status_code')=='PUBLISHED':
        ctx.result(container,note='Instagram medyayı yayımladı; gösterilen kimlik medya hazırlama kimliğidir.');return
    if r.get('status_code') in ('ERROR','EXPIRED'): raise PlatformError('instagram','processing','Instagram medyayı işleyemedi veya medya bağlantısının süresi doldu. Yeni bir dosya ile tekrar dene.')
    if r.get('status_code')!='FINISHED': raise Waiting(15,'Instagram medyayı hazırlıyor; hazır olunca otomatik yayımlanacak.')
    ctx.final();r=request('instagram','POST',base+ctx.credential.account_id+'/media_publish',ctx.token,final=True,json={'creation_id':container})
    ctx.result(r.get('id'))

@celery.task(name='akis.send_to_instagram')
def send_to_instagram(identifier):
    from ..jobs import run_delivery
    run_delivery(identifier)
