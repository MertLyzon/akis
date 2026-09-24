from urllib.parse import urlsplit
from ..queue import celery
from ..platform_http import request
from ..storage import local_file
from ..security import encrypt,decrypt
from ..errors import PlatformError
from .common import Waiting

def publish(ctx):
    a=ctx.asset
    if not a or a.mime_type!='video/mp4': raise PlatformError('tiktok','v_inbox_url')
    publish_id=ctx.progress.get('publish_id')
    if not publish_id:
        # TikTok allows a single small file; otherwise merge the remainder into the last chunk.
        chunk_size=min(a.size,10*1024*1024)
        count=max(1,a.size//chunk_size)
        r=request('tiktok','POST','https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',ctx.token,json={'source_info':{'source':'FILE_UPLOAD','video_size':a.size,'chunk_size':chunk_size,'total_chunk_count':count}})
        data=r.get('data',{});publish_id=data.get('publish_id');url=data.get('upload_url','')
        host=urlsplit(url).hostname or ''
        if not publish_id or urlsplit(url).scheme!='https' or not (host.endswith('.tiktokapis.com') or host.endswith('.tiktokcdn.com')): raise PlatformError('tiktok','upload_url','TikTok geçerli bir dosya aktarım adresi döndürmedi.')
        ctx.checkpoint(publish_id=publish_id,upload_url=encrypt(url),chunk_size=chunk_size,chunk_count=count,uploaded=0)
    if not ctx.progress.get('upload_complete'):
        url=decrypt(ctx.progress['upload_url']);size=ctx.progress['chunk_size'];count=ctx.progress['chunk_count']
        with local_file(a) as local,local.open('rb') as file:
            index=ctx.progress.get('uploaded',0);file.seek(index*size)
            while index<count:
                chunk=file.read() if index==count-1 else file.read(size)
                start=index*size
                request('tiktok','PUT',url,content=chunk,headers={'Content-Type':'video/mp4','Content-Length':str(len(chunk)),'Content-Range':f'bytes {start}-{start+len(chunk)-1}/{a.size}'})
                index+=1;ctx.checkpoint(uploaded=index)
        ctx.checkpoint(upload_complete=True)
    r=request('tiktok','POST','https://open.tiktokapis.com/v2/post/publish/status/fetch/',ctx.token,json={'publish_id':publish_id})
    data=r.get('data',{});status=data.get('status')
    if status=='FAILED': raise PlatformError('tiktok',data.get('fail_reason','upload_failed'))
    if status=='PUBLISH_COMPLETE': ctx.result(publish_id);return
    if status=='SEND_TO_USER_INBOX':
        ctx.result(publish_id,'submitted','Video TikTok gelen kutuna aktarıldı. Bildirimi açıp paylaşımı TikTok uygulamasında tamamla.');return
    raise Waiting(20,'TikTok videoyu işliyor.')

@celery.task(name='akis.send_to_tiktok')
def send_to_tiktok(identifier):
    from ..jobs import run_delivery
    run_delivery(identifier)
