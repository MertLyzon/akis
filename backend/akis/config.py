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
    # Named Cloudflare Tunnel used by scripts/public_dev.py (development only).
    cloudflare_tunnel: str = 'akis-dev'
    public_tunnel_provider: str = 'cloudflare'
    admin_password_hash: str = ''
    local_mode: bool = True
    media_root: str = str(ROOT / 'data' / 'media')
    max_upload_mb: int = 100
    # Total media rows (sources and generated variants) allowed per company. 0 disables the quota.
    company_storage_mb: int = 500
    media_max_duration_seconds: int = 600
    media_max_pixels: int = 40_000_000
    ffmpeg_threads: int = 1
    ffmpeg_timeout_seconds: int = 420
    graph_version: str = 'v23.0'
    ffmpeg_path: str = ''
    ffprobe_path: str = ''
    queue_mode: str = 'celery'
    admin_email: str = 'admin@akis.local'
    cloudinary_url: str = ''
    # Keep processed files on local disk after uploading to Cloudinary (cache for workers on the same host).
    keep_local_media: bool = True
    backup_dir: str = str(ROOT / 'backups')
    # Set to 0 to disable scheduled backups while keeping manual backups available.
    backup_interval_days: int = 7
    backup_keep: int = 3
    # auto uploads verified backups to private Cloudinary raw storage when configured.
    backup_remote: str = 'auto'
    backup_download_max_mb: int = 500
    # Terminal delivery diagnostics older than this are pruned daily. 0 keeps them indefinitely.
    delivery_attempt_retention_days: int = 90
    # Origins of the Tauri apps (desktop + mobile webviews). They authenticate with a bearer token, not cookies.
    app_client_origins: str = 'tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:1420'

settings = Settings()
# Empty DATABASE_URL in .env means "use the default" (SQLite locally, Compose sets its own).
if not settings.database_url: settings.database_url = 'sqlite:///' + str(ROOT / 'data' / 'akis.db')
# Hosted providers (Neon, Supabase, Railway…) give postgres:// URLs; SQLAlchemy needs the psycopg driver named.
for prefix in ('postgres://','postgresql://'):
    if settings.database_url.startswith(prefix): settings.database_url='postgresql+psycopg://'+settings.database_url[len(prefix):]
(ROOT / 'data').mkdir(exist_ok=True)
Path(settings.media_root).mkdir(parents=True, exist_ok=True)
