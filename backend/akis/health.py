"""Dependency and background-process health reporting.

The public liveness endpoint intentionally stays cheap. Readiness and the
system dashboard use this module to verify the dependencies needed to accept
real work. Worker and Beat write short-lived Redis heartbeats from their own
processes, so a healthy API cannot hide a stopped queue process.
"""

from __future__ import annotations

import logging
import threading
import time
from urllib.parse import urlsplit

from . import release_info
from . import storage
from .config import settings
from .db import engine

log = logging.getLogger(__name__)

HEARTBEAT_INTERVAL_SECONDS = 5
HEARTBEAT_STALE_SECONDS = 20
HEARTBEAT_TTL_SECONDS = 60
_started: set[str] = set()
_start_lock = threading.Lock()


def redis_client():
    import redis

    return redis.Redis.from_url(
        settings.redis_url,
        socket_connect_timeout=2,
        socket_timeout=2,
        decode_responses=True,
    )


def heartbeat_key(role: str) -> str:
    if role not in {"worker", "beat"}:
        raise ValueError("Unknown heartbeat role")
    return f"akis:health:{role}"


def write_heartbeat(role: str, client=None, timestamp: int | None = None) -> int:
    stamp = int(time.time() if timestamp is None else timestamp)
    (client or redis_client()).set(heartbeat_key(role), stamp, ex=HEARTBEAT_TTL_SECONDS)
    return stamp


def start_heartbeat(role: str) -> None:
    """Start one daemon heartbeat loop in the current Worker/Beat process."""
    with _start_lock:
        if role in _started:
            return
        _started.add(role)

    def run() -> None:
        while True:
            try:
                write_heartbeat(role)
            except Exception:
                # Redis outages are already visible through readiness. Keep the
                # process alive so it can recover without a restart storm.
                log.warning("Could not publish %s heartbeat", role)
            time.sleep(HEARTBEAT_INTERVAL_SECONDS)

    threading.Thread(target=run, name=f"akis-{role}-heartbeat", daemon=True).start()


def _heartbeat(client, role: str, checked_at: int) -> tuple[bool, int | None]:
    raw = client.get(heartbeat_key(role))
    try:
        last_seen = int(raw) if raw is not None else None
    except (TypeError, ValueError):
        last_seen = None
    return bool(last_seen and checked_at - last_seen <= HEARTBEAT_STALE_SECONDS), last_seen


def service_health() -> dict:
    checked_at = int(time.time())
    result = {
        "database": False,
        "redis": None,
        "worker": None,
        "beat": None,
        "worker_last_seen": None,
        "beat_last_seen": None,
        "storage": None,
        "queue_mode": settings.queue_mode,
        "database_kind": engine.dialect.name,
        "checked_at": checked_at,
        "release": release_info(),
    }
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("select 1")
        result["database"] = True
    except Exception:
        pass

    if settings.queue_mode == "celery":
        try:
            client = redis_client()
            result["redis"] = bool(client.ping())
            result["worker"], result["worker_last_seen"] = _heartbeat(client, "worker", checked_at)
            result["beat"], result["beat_last_seen"] = _heartbeat(client, "beat", checked_at)
        except Exception:
            result["redis"] = False
            result["worker"] = False
            result["beat"] = False
    try:
        result["storage"] = storage.ping()
    except Exception:
        result["storage"] = False
    return result


def is_ready(health: dict) -> bool:
    queue_ready = True
    if health["queue_mode"] == "celery":
        queue_ready = health["redis"] is True and health["worker"] is True and health["beat"] is True
    # None means local disk storage; only an explicitly failed configured
    # remote store makes the service unready.
    return health["database"] is True and health["storage"] is not False and queue_ready


def _https_url(value: str, origin: bool = False) -> bool:
    try:
        parsed = urlsplit(value.strip())
    except (TypeError, ValueError):
        return False
    return bool(
        parsed.scheme == 'https'
        and parsed.hostname
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
        and (not origin or parsed.path in ('', '/'))
    )


def deployment_checks(public_base_url: str) -> dict:
    """Safe production configuration checks; values and secrets are never returned."""
    if settings.local_mode:
        return {'mode':'local','ready':True,'checks':[{'code':'local_mode','ok':True,'severity':'info'}]}

    remote_storage = storage.enabled()
    checks = [
        {'code':'server_mode','ok':True,'severity':'critical'},
        {'code':'app_origin_https','ok':_https_url(settings.app_origin,origin=True),'severity':'critical'},
        {'code':'postgresql','ok':engine.dialect.name=='postgresql','severity':'critical'},
        {'code':'celery_queue','ok':settings.queue_mode=='celery','severity':'critical'},
        {'code':'admin_password','ok':bool(settings.admin_password_hash.strip()),'severity':'critical'},
        {'code':'public_media','ok':remote_storage or _https_url(public_base_url),'severity':'warning'},
        {'code':'cloud_storage','ok':remote_storage,'severity':'warning'},
    ]
    return {'mode':'server','ready':all(check['ok'] for check in checks if check['severity']=='critical'),'checks':checks}
