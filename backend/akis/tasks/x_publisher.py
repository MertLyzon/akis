import base64
from ..queue import celery
from ..platform_http import request
from ..media import path_for
from ..errors import PlatformError
from .common import Waiting

def publish(ctx):
    media_id=ctx.progress.get('media_id')
    if ctx.asset:
        asset=ctx.asset
        if asset.size>(512*1024*1024 if asset.mime_type.startswith('video') else 5*1024*1024): raise PlatformError('x','size','X için görsel en fazla 5 MB, video en fazla 512 MB olabilir.')
        if not media_id:
            r=request('x','POST','https://api.x.com/2/media/upload/initialize',ctx.token,json={'media_type':asset.mime_type,'total_bytes':asset.size,'media_category':'tweet_video' if asset.mime_type.startswith('video') else 'tweet_image'})
            media_id=r.get('data',{}).get('id')
            if not media_id: raise PlatformError('x','media_id','X medya kimliği oluşturamadı.',retryable=True)
            ctx.checkpoint(media_id=media_id,segment=0)
        if not ctx.progress.get('finalized'):
            chunk_size=4*1024*1024
            with path_for(asset.storage_key).open('rb') as file:
                segment=ctx.progress.get('segment',0);file.seek(segment*chunk_size)
                while chunk:=file.read(chunk_size):
                    request('x','POST',f'https://api.x.com/2/media/upload/{media_id}/append',ctx.token,files={'media':('chunk',chunk,'application/octet-stream')},data={'segment_index':str(segment)})
                    segment+=1;ctx.checkpoint(segment=segment)
            r=request('x','POST',f'https://api.x.com/2/media/upload/{media_id}/finalize',ctx.token)
            ctx.checkpoint(finalized=True)
            info=r.get('data',{}).get('processing_info',{})
        else:
            r=request('x','GET','https://api.x.com/2/media/upload',ctx.token,params={'media_id':media_id,'command':'STATUS'})
            info=r.get('data',{}).get('processing_info',{})
        if info.get('state') in ('pending','in_progress'): raise Waiting(min(60,int(info.get('check_after_secs',10))))
        if info.get('state')=='failed': raise PlatformError('x','media_processing','X videoyu işleyemedi. Video biçimini ve süresini kontrol et.')
    payload={}
    if ctx.content.body_text: payload['text']=ctx.content.body_text
    if media_id: payload['media']={'media_ids':[str(media_id)]}
    ctx.final();r=request('x','POST','https://api.x.com/2/tweets',ctx.token,final=True,json=payload)
    ctx.result(r.get('data',{}).get('id'))

@celery.task(name='akis.send_to_x')
def send_to_x(identifier):
    from ..jobs import run_delivery
    run_delivery(identifier)
