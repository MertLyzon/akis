"""Remote media storage (Cloudinary). Local disk stays the processing area and cache."""
import shutil, tempfile
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

@contextmanager
def local_file(asset):
    """Yield a local path for the asset, downloading from Cloudinary when this worker has no copy."""
    from .media import path_for
    path=path_for(asset.storage_key) if asset.storage_key else None
    if path and path.exists():
        yield path;return
    if not asset.remote_url: raise FileNotFoundError('Medya dosyası bulunamadı.')
    host=urlsplit(asset.remote_url).hostname or ''
    if not host.endswith('cloudinary.com'): raise FileNotFoundError('Medya kaynağı doğrulanamadı.')
    folder=Path(tempfile.mkdtemp(prefix='akis-media-',dir=settings.media_root))
    target=folder/('file'+Path(asset.storage_key or '.bin').suffix)
    try:
        with httpx.stream('GET',asset.remote_url,timeout=httpx.Timeout(120,connect=15),follow_redirects=True) as r:
            r.raise_for_status()
            with target.open('wb') as f:
                for chunk in r.iter_bytes(1024*1024): f.write(chunk)
        yield target
    finally: shutil.rmtree(folder,ignore_errors=True)
