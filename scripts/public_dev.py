"""Run Akis locally behind an already configured stable public tunnel."""

import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]


def project_settings():
    sys.path.insert(0, str(ROOT / "backend"))
    from akis.config import settings

    return settings


def public_url(settings) -> str:
    value = os.environ.get("AKIS_PUBLIC_URL", "").strip().rstrip("/")
    if not value:
        # Settings reads the project's .env file and keeps credentials out of this launcher.
        value = (settings.public_base_url or settings.app_origin).strip().rstrip("/")

    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.path:
        raise SystemExit(
            "APP_ORIGIN/PUBLIC_BASE_URL sabit bir HTTPS adresi olmali "
            "(ornek: https://akis.ornek.com)."
        )
    if parsed.hostname.endswith(".trycloudflare.com"):
        raise SystemExit(
            "trycloudflare.com adresleri gecicidir. Once README'deki 'Sabit gelistirme adresi' "
            "kurulumunu tamamlayin."
        )
    return value


def terminate(processes: list[subprocess.Popen]) -> None:
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
    for process in reversed(processes):
        if process.poll() is None:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


def main() -> None:
    os.chdir(ROOT)
    settings = project_settings()
    origin = public_url(settings)
    provider = os.environ.get("PUBLIC_TUNNEL_PROVIDER", settings.public_tunnel_provider).strip().lower()
    if provider == "ngrok":
        if not shutil.which("ngrok"):
            raise SystemExit("ngrok bulunamadi. macOS: brew install ngrok/ngrok/ngrok")
        tunnel_command = ["ngrok", "http", "8000", "--url", origin]
        tunnel_label = "ngrok Tunnel"
    elif provider == "cloudflare":
        if not shutil.which("cloudflared"):
            raise SystemExit("cloudflared bulunamadi. macOS: brew install cloudflared")
        tunnel = os.environ.get("CLOUDFLARE_TUNNEL", settings.cloudflare_tunnel).strip()
        if not tunnel:
            raise SystemExit("CLOUDFLARE_TUNNEL bos olamaz.")
        tunnel_command = [
            "cloudflared",
            "tunnel",
            "--protocol",
            "http2",
            "--url",
            "http://127.0.0.1:8000",
            "run",
            tunnel,
        ]
        tunnel_label = "Cloudflare Tunnel"
    else:
        raise SystemExit("PUBLIC_TUNNEL_PROVIDER yalnizca 'ngrok' veya 'cloudflare' olabilir.")

    env = {
        **os.environ,
        "PYTHONPATH": str(ROOT / "backend"),
        "QUEUE_MODE": "local",
        "LOCAL_MODE": "false",
        "APP_ORIGIN": origin,
        "PUBLIC_BASE_URL": origin,
    }

    subprocess.run([sys.executable, "scripts/bootstrap.py"], check=True, env=env)
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "upgrade", "head"],
        check=True,
        env=env,
    )
    subprocess.run([sys.executable, "scripts/import_legacy.py"], check=True, env=env)
    subprocess.run(["npm", "run", "build"], check=True, env=env)

    processes: list[subprocess.Popen] = []
    try:
        processes.append(
            subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "akis.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8000",
                    "--no-access-log",
                ],
                env=env,
            )
        )
        processes.append(
            subprocess.Popen(tunnel_command, env=env)
        )
        print(f"Akis: {origin}/  (Ctrl+C tum servisleri durdurur)", flush=True)

        while True:
            for name, process in zip(("Backend", tunnel_label), processes):
                code = process.poll()
                if code is not None:
                    raise RuntimeError(f"{name} durdu (cikis kodu: {code}). Yukaridaki ciktiyi kontrol edin.")
            signal.pause()
    except KeyboardInterrupt:
        pass
    finally:
        terminate(processes)


if __name__ == "__main__":
    main()
