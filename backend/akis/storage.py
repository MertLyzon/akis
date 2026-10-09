"""Remote media and private backup storage (Cloudinary)."""
import re, shutil, tempfile, time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit
import httpx
from .config import settings

_configured=None

def enabled():
    global _configured
    if _configured is None:
        _configured=False
        if settings.cloudinary_url:
            u=urlsplit(settings.cloudinary_url)
            if u.scheme!='cloudinary' or not (u.hostname and u.username and u.password): raise RuntimeError('CLOUDINARY_URL must look like cloudinary://API_KEY:API_SECRET@CLOUD_NAME')
            import cloudinary
            cloudinary.config(cloud_name=u.hostname,api_key=u.username,api_secret=u.password,secure=True)
            _configured=True
    return _configured

def resource_type(mime): return 'video' if mime.startswith('video') else 'image'

def upload(path,asset):
    """Upload a processed file; returns (secure_url, public_id). public_id is namespaced per company."""
    import cloudinary.uploader
    r=cloudinary.uploader.upload(str(path),resource_type=resource_type(asset.mime_type),public_id=f'akis/{asset.company_id}/{asset.id}',overwrite=True,invalidate=True,use_filename=False,unique_filename=False)
    return r['secure_url'],r['public_id']

def delete(asset):
    if not (enabled() and asset.remote_id): return
    import cloudinary.uploader
    cloudinary.uploader.destroy(asset.remote_id,resource_type=resource_type(asset.mime_type),invalidate=True)

def ping():
    if not enabled(): return None
    import cloudinary.api
    return cloudinary.api.ping().get('status')=='ok'

BACKUP_NAME=re.compile(r'^akis-\d{8}-\d{6}\.json\.gz$')
BACKUP_PREFIX='akis-backups/'

def backup_enabled():
    mode=settings.backup_remote.strip().lower()
    if mode not in {'auto','cloudinary','local'}: raise RuntimeError('BACKUP_REMOTE must be auto, cloudinary or local')
    return mode!='local' and enabled()

def _backup_public_id(name):
    if not BACKUP_NAME.fullmatch(name): raise ValueError('Invalid backup name')
    return BACKUP_PREFIX+name

def upload_backup(path):
    """Upload an exact database archive as a non-public raw asset."""
    import cloudinary.uploader
    name=Path(path).name
    result=cloudinary.uploader.upload(str(path),resource_type='raw',type='private',public_id=_backup_public_id(name),overwrite=True,invalidate=False,use_filename=False,unique_filename=False)
    return {'file':name,'size':int(result.get('bytes') or Path(path).stat().st_size),'created_at':int(time.time()),'location':'remote'}

def list_remote_backups():
    import cloudinary.api
    result=cloudinary.api.resources(resource_type='raw',type='private',prefix=BACKUP_PREFIX,max_results=500)
    rows=[]
    for item in result.get('resources',[]):
        public_id=item.get('public_id','')
        name=public_id.removeprefix(BACKUP_PREFIX)
        if not BACKUP_NAME.fullmatch(name): continue
        created=item.get('created_at','')
        try:
            from datetime import datetime
            created_at=int(datetime.fromisoformat(created.replace('Z','+00:00')).timestamp())
        except (TypeError,ValueError): created_at=0
        rows.append({'file':name,'size':int(item.get('bytes') or 0),'created_at':created_at,'location':'remote'})
    return sorted(rows,key=lambda row:row['file'],reverse=True)

def download_backup(name,target):
    """Download a private archive using a five-minute server-signed URL."""
    import cloudinary.utils
    url=cloudinary.utils.private_download_url(_backup_public_id(name),'',resource_type='raw',type='private',expires_at=int(time.time())+300)
    maximum=max(1,settings.backup_download_max_mb)*1024*1024
    size=0
    with httpx.stream('GET',url,timeout=httpx.Timeout(120,connect=15),follow_redirects=False) as response:
        response.raise_for_status()
        with Path(target).open('wb') as output:
            for chunk in response.iter_bytes(1024*1024):
                size+=len(chunk)
                if size>maximum: raise ValueError('Remote backup is too large')
                output.write(chunk)
    return Path(target)

def delete_backup(name):
    import cloudinary.uploader
    return cloudinary.uploader.destroy(_backup_public_id(name),resource_type='raw',type='private',invalidate=False)

def trusted_remote(url):
    u=urlsplit(url or '');host=u.hostname or ''
    return u.scheme=='https' and not u.username and not u.password and (host=='cloudinary.com' or host.endswith('.cloudinary.com'))

@contextmanager
def local_file(asset):
    """Yield a local path for the asset, downloading from Cloudinary when this worker has no copy."""
    from .media import path_for
    path=path_for(asset.storage_key) if asset.storage_key else None
    if path and path.exists():
        yield path;return
    if not asset.remote_url: raise FileNotFoundError('Medya dosyası bulunamadı.')
    if not trusted_remote(asset.remote_url): raise FileNotFoundError('Medya kaynağı doğrulanamadı.')
    folder=Path(tempfile.mkdtemp(prefix='akis-media-',dir=settings.media_root))
    target=folder/('file'+Path(asset.storage_key or '.bin').suffix)
    try:
        with httpx.stream('GET',asset.remote_url,timeout=httpx.Timeout(120,connect=15),follow_redirects=False) as r:
            r.raise_for_status()
            with target.open('wb') as f:
                for chunk in r.iter_bytes(1024*1024): f.write(chunk)
        yield target
    finally: shutil.rmtree(folder,ignore_errors=True)
