import math, os, re, shutil, subprocess, tempfile, time
from pathlib import Path
from PIL import Image, ImageOps, UnidentifiedImageError
import pillow_heif
from sqlalchemy import select, update
from .config import settings
from .db import Session
from .models import MediaAsset, now, AppSetting
from .security import sign
from .errors import PlatformError

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = 40_000_000

def path_for(key):
    root=Path(settings.media_root).resolve()
    path=(root/key).resolve()
    if path.parent!=root: raise ValueError('Geçersiz medya yolu')
    return path

def public_base(db):
    row=db.get(AppSetting,'public_base_url')
    return (row.value if row else settings.public_base_url).rstrip('/')

def media_url(asset,db,public=False):
    expires=now()+86400*2
    relative=f'/api/media/{asset.id}/file?expires={expires}&signature={sign(f"{asset.id}:{expires}")}'
    if public:
        base=public_base(db)
        if not base.startswith('https://'): raise PlatformError('instagram','public_url','Instagram’ın dosyayı okuyabilmesi için Ayarlar bölümüne bu sunucuya yönlenen herkese açık HTTPS adresini ekle.')
        return base+relative
    return relative

def ffmpeg():
    if settings.ffmpeg_path: return settings.ffmpeg_path
    found=shutil.which('ffmpeg')
    if found: return found
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def run_ffmpeg(args):
    result=subprocess.run([ffmpeg(),'-hide_banner','-nostdin','-y',*args],capture_output=True,timeout=420)
    if result.returncode: raise PlatformError('media','conversion','Medya dönüştürülemedi. Dosyanın açılabildiğini kontrol edip yeniden yükle.')

def probe(path):
    if settings.ffprobe_path or shutil.which('ffprobe'):
        import json
        result=subprocess.run([settings.ffprobe_path or shutil.which('ffprobe'),'-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',str(path)],capture_output=True,timeout=20)
        if result.returncode: raise ValueError('Dosya okunamadı')
        info=json.loads(result.stdout)
        v=next(s for s in info['streams'] if s['codec_type']=='video')
        return int(v['width']),int(v['height']),float(info.get('format',{}).get('duration') or v.get('duration',0)),any(s['codec_type']=='audio' for s in info['streams'])
    result=subprocess.run([ffmpeg(),'-hide_banner','-nostdin','-protocol_whitelist','file,pipe','-i',str(path)],capture_output=True,timeout=20)
    info=result.stderr.decode(errors='replace')
    duration=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',info)
    size=re.search(r'Video:.*?\b(\d{2,5})x(\d{2,5})\b',info)
    if not duration or not size: raise ValueError('Desteklenmeyen video')
    h,m,s=map(float,duration.groups())
    return int(size[1]),int(size[2]),h*3600+m*60+s,'Audio:' in info

def normalize_image(source,target):
    with Image.open(source) as im:
        im=ImageOps.exif_transpose(im)
        if im.mode in ('RGBA','LA') or 'transparency' in im.info:
            rgba=im.convert('RGBA');background=Image.new('RGBA',rgba.size,'white');background.alpha_composite(rgba);im=background.convert('RGB')
        else: im=im.convert('RGB')
        original=im.size
        w,h=im.size
        ratio=w/h
        if ratio<0.8: w=math.ceil(h*0.8)
        elif ratio>1.91: h=math.ceil(w/1.91)
        # Resize before padding so an extreme panorama cannot allocate a huge canvas.
        factor=min(1,1920/w,1080/h)
        cw,ch=max(2,math.ceil(w*factor)),max(2,math.ceil(h*factor))
        # Rounding must not push a panorama outside Instagram's strict ratio limit.
        if cw/ch>1.91: ch=math.ceil(cw/1.91)
        if cw/ch<0.8: cw=math.ceil(ch*0.8)
        canvas_size=(cw,ch)
        im.thumbnail((max(1,int(im.width*factor)),max(1,int(im.height*factor))),Image.Resampling.LANCZOS)
        canvas=Image.new('RGB',canvas_size,'white')
        canvas.paste(im,((canvas.width-im.width)//2,(canvas.height-im.height)//2))
        canvas.save(target,'JPEG',quality=90,optimize=True)
        return canvas.width,canvas.height,('Görsel JPEG olarak hazırlandı. '+('İçerik kesilmeden uygun boyut ve orana getirildi.' if original!=canvas.size else ''))

def transcode(source,target,vertical=False,still=False):
    vf=('scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1' if vertical else 'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1')
    if still:
        args=['-loop','1','-i',str(source),'-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000','-t','4','-vf',vf,'-map','0:v:0','-map','1:a:0']
    else:
        w,h,duration,audio=probe(source)
        if duration>600 or w*h>40_000_000: raise PlatformError('media','video_limit','Video en fazla 10 dakika ve 40 megapiksel olabilir.')
        args=['-protocol_whitelist','file,pipe','-i',str(source)]
        if not audio: args+=['-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000']
        args+=['-vf',vf,'-map','0:v:0','-map','0:a:0' if audio else '1:a:0','-t',str(duration)]
    run_ffmpeg(args+['-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','128k','-movflags','+faststart','-threads','2',str(target)])
    return probe(target)

def process_asset(asset_id):
    with Session() as db:
        claimed=db.execute(update(MediaAsset).where(MediaAsset.id==asset_id,MediaAsset.status=='processing').values(status='converting',updated_at=now())).rowcount
        db.commit()
        if not claimed: return
        a=db.get(MediaAsset,asset_id)
        source=path_for(a.storage_key)
        try:
            if a.mime_type.startswith('image/'):
                key=a.id+'.jpg';target=path_for(key)
                a.width,a.height,a.note=normalize_image(source,target);a.mime_type='image/jpeg'
            else:
                key=a.id+'.mp4';target=path_for(key)
                a.width,a.height,a.duration_seconds,_=transcode(source,target)
                a.mime_type='video/mp4';a.note='Video H.264/AAC biçiminde hazırlandı.'
            a.storage_key=key;a.size=target.stat().st_size;a.status='ready';a.updated_at=now();db.commit()
        except Exception as exc:
            a.status='failed';a.error=exc.message if isinstance(exc,PlatformError) else 'Dosya okunamadı. Geçerli bir görsel veya video yükle.';a.updated_at=now();db.commit()

def variant_for(db,source,platform):
    if platform!='tiktok': return source
    existing=db.scalar(select(MediaAsset).where(MediaAsset.source_asset_id==source.id,MediaAsset.variant=='tiktok'))
    if existing and existing.status=='ready': return existing
    # Dispatcher's source lock serializes generation across multiple posts.
    with __import__('akis.tokens',fromlist=['asset_lock']).asset_lock(source.id):
        existing=db.scalar(select(MediaAsset).where(MediaAsset.source_asset_id==source.id,MediaAsset.variant=='tiktok'))
        if existing and existing.status=='ready': return existing
        v=existing or MediaAsset(owner=source.owner,filename='tiktok.mp4',storage_key='',mime_type='video/mp4',source_asset_id=source.id,variant='tiktok',is_auto_generated=True,status='converting')
        if not existing: db.add(v);db.flush()
        key=v.id+'.mp4';target=path_for(key)
        v.width,v.height,v.duration_seconds,_=transcode(path_for(source.storage_key),target,vertical=True,still=source.mime_type.startswith('image/'))
        v.storage_key=key;v.size=target.stat().st_size;v.status='ready';v.updated_at=now()
        v.note='TikTok için görselin 4 saniyelik, sessiz ses kanallı dikey videoya çevrildi.' if source.mime_type.startswith('image/') else 'TikTok için video 9:16 dikey alana yerleştirildi.'
        db.commit();return v
