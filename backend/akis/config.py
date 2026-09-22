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

settings = Settings()
Path(settings.media_root).mkdir(parents=True, exist_ok=True)
