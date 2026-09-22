from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT / '.env'), extra='ignore')
    database_url: str = 'sqlite:///' + str(ROOT / 'data' / 'akis.db')
    redis_url: str = 'redis://localhost:6379/0'
    credential_key: str = ''
    app_origin: str = 'http://localhost:5173'
    public_base_url: str = ''
    admin_password_hash: str = ''
    local_mode: bool = True
    media_root: str = str(ROOT / 'data' / 'media')
    max_upload_mb: int = 100
    graph_version: str = 'v23.0'
    ffmpeg_path: str = ''
    ffprobe_path: str = ''
    queue_mode: str = 'celery'
    admin_email: str = 'admin@akis.local'
    cloudinary_url: str = ''
    # Keep processed files on local disk after uploading to Cloudinary (cache for workers on the same host).
    keep_local_media: bool = True
    backup_dir: str = str(ROOT / 'backups')
    backup_keep: int = 14

settings = Settings()
# Empty DATABASE_URL in .env means "use the default" (SQLite locally, Compose sets its own).
if not settings.database_url: settings.database_url = 'sqlite:///' + str(ROOT / 'data' / 'akis.db')
# Hosted providers (Neon, Supabase, Railway…) give postgres:// URLs; SQLAlchemy needs the psycopg driver named.
for prefix in ('postgres://','postgresql://'):
    if settings.database_url.startswith(prefix): settings.database_url='postgresql+psycopg://'+settings.database_url[len(prefix):]
(ROOT / 'data').mkdir(exist_ok=True)
Path(settings.media_root).mkdir(parents=True, exist_ok=True)
