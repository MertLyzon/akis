from ..queue import celery
from ..platform_http import request
from ..storage import local_file
from ..config import settings
from ..errors import PlatformError

def publish(ctx):
    base=f'https://graph.facebook.com/{settings.graph_version}/{ctx.credential.account_id}'
    media_id=ctx.progress.get('media_id');a=ctx.asset
    if a and not media_id:
        if a.size>(16*1024*1024 if a.mime_type.startswith('video') else 5*1024*1024): raise PlatformError('whatsapp','size','WhatsApp için görsel en fazla 5 MB, video en fazla 16 MB olabilir.')
        with local_file(a) as local,local.open('rb') as file:
            r=request('whatsapp','POST',base+'/media',ctx.token,data={'messaging_product':'whatsapp','type':a.mime_type},files={'file':('media.mp4' if a.mime_type.startswith('video') else 'media.jpg',file,a.mime_type)})
        media_id=r.get('id')
        if not media_id: raise PlatformError('whatsapp','media_id','WhatsApp medya yüklemesini tamamlayamadı.',retryable=True)
        ctx.checkpoint(media_id=media_id)
    opts=ctx.content.options
    payload={'messaging_product':'whatsapp','to':ctx.delivery.recipient}
    media_type='video' if a and a.mime_type.startswith('video') else 'image'
    if opts.get('wa_mode','template')=='template':
        template={'name':opts['template'],'language':{'code':opts.get('language','tr')}};components=[]
        if media_id: components.append({'type':'header','parameters':[{'type':media_type,media_type:{'id':media_id}}]})
        if opts.get('template_params'): components.append({'type':'body','parameters':[{'type':'text','text':v} for v in opts['template_params']]})
        if components: template['components']=components
        payload.update(type='template',template=template)
    elif media_id:
        payload.update(type=media_type);payload[media_type]={'id':media_id}
        if ctx.content.body_text: payload[media_type]['caption']=ctx.content.body_text
    else: payload.update(type='text',text={'body':ctx.content.body_text})
    ctx.final();r=request('whatsapp','POST',base+'/messages',ctx.token,final=True,json=payload)
    messages=r.get('messages',[])
    ctx.result(messages[0].get('id') if messages else None,'submitted','WhatsApp mesajı kabul etti. Bu durum alıcıya teslim edildiğini veya okunduğunu göstermez.')

@celery.task(name='akis.send_to_whatsapp')
def send_to_whatsapp(identifier):
    from ..jobs import run_delivery
    run_delivery(identifier)
