"""Run an isolated local Akış stack for browser smoke tests."""

from __future__ import annotations

import base64
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "work"
WORK.mkdir(exist_ok=True)
runtime = Path(tempfile.mkdtemp(prefix="akis-e2e-", dir=WORK))

environment = os.environ.copy()
environment.update(
    {
        "DATABASE_URL": f"sqlite:///{runtime / 'akis.db'}",
        "MEDIA_ROOT": str(runtime / "media"),
        "BACKUP_DIR": str(runtime / "backups"),
        "CREDENTIAL_KEY": base64.b64encode(secrets.token_bytes(32)).decode(),
        "LOCAL_MODE": "true",
        "QUEUE_MODE": "test",
        "APP_ORIGIN": "http://127.0.0.1:5173",
        "PUBLIC_BASE_URL": "",
        "CLOUDINARY_URL": "",
        "ADMIN_PASSWORD_HASH": "",
        "BACKUP_INTERVAL_DAYS": "0",
        "PYTHONPATH": str(ROOT / "backend"),
    }
)

children: list[subprocess.Popen] = []
stopping = False


def stop(*_args) -> None:
    global stopping
    stopping = True
    for child in children:
        if child.poll() is None:
            child.terminate()


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

try:
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "upgrade", "head"],
        cwd=ROOT,
        env=environment,
        check=True,
    )
    children.extend(
        [
            subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "akis.main:app", "--host", "127.0.0.1", "--port", "8000"],
                cwd=ROOT / "backend",
                env=environment,
            ),
            subprocess.Popen(
                ["npm", "run", "dev", "--", "--strictPort"],
                cwd=ROOT,
                env=environment,
            ),
        ]
    )
    while not stopping and all(child.poll() is None for child in children):
        time.sleep(0.2)
    if not stopping:
        raise SystemExit(next((child.returncode for child in children if child.returncode), 1))
finally:
    stop()
    for child in children:
        try:
            child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            child.kill()
    shutil.rmtree(runtime, ignore_errors=True)
