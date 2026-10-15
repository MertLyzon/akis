"""Small, process-local operational diagnostics safe to expose to system admins.

The buffer deliberately contains no exception messages, request bodies, query strings,
headers or user identifiers. It is bounded and disappears whenever the API restarts.
"""
from collections import deque
from threading import Lock
import re
import time

_MAX_ERRORS = 20
_RECENT_ERROR_SECONDS = 15 * 60
_SLOW_DEPENDENCY_MS = {
    'database': 1_000,
    'redis': 1_000,
    'storage': 3_000,
}
_SUPPORT_CODE = re.compile(r'^[0-9a-f]{12}$')
_METHOD = re.compile(r'^[A-Z]{1,12}$')
_errors = deque(maxlen=_MAX_ERRORS)
_lock = Lock()


def _safe_path(value: str) -> str:
    # Callers pass req.url.path, but stripping a possible query here keeps this
    # module safe if it is reused elsewhere later.
    path = str(value or '').split('?', 1)[0]
    return ''.join(char if char.isprintable() and char not in '\r\n\t' else '?' for char in path)[:160]


def record_api_error(support_code: str, method: str, path: str, timestamp: int | None = None) -> dict:
    code = str(support_code or '').lower()
    verb = str(method or '').upper()
    item = {
        'at': int(time.time() if timestamp is None else timestamp),
        'support_code': code if _SUPPORT_CODE.fullmatch(code) else '',
        'method': verb if _METHOD.fullmatch(verb) else '?',
        'path': _safe_path(path),
    }
    with _lock:
        _errors.append(item)
    return item


def recent_api_errors() -> list[dict]:
    with _lock:
        return list(reversed(_errors))


def operational_summary(health: dict, queue: dict, api_errors: list[dict], deployment: dict | None = None, checked_at: int | None = None) -> dict:
    """Turn raw health counters into a small, stable operator-facing summary."""
    issues = []
    for key, code in (
        ('database', 'database_unavailable'),
        ('redis', 'redis_unavailable'),
        ('worker', 'worker_unavailable'),
        ('beat', 'scheduler_unavailable'),
        ('storage', 'storage_unavailable'),
    ):
        if health.get(key) is False:
            issues.append({'code':code,'severity':'critical','count':1})

    for key, code in (
        ('database', 'database_slow'),
        ('redis', 'redis_slow'),
        ('storage', 'storage_slow'),
    ):
        latency = health.get(f'{key}_ms')
        if health.get(key) is True and isinstance(latency, (int, float)) and not isinstance(latency, bool) and latency > _SLOW_DEPENDENCY_MS[key]:
            issues.append({'code':code,'severity':'warning','count':1})

    for key, code in (('stuck_sending', 'stuck_deliveries'), ('media_failed', 'failed_media')):
        count = max(0, int(queue.get(key) or 0))
        if count:
            issues.append({'code':code,'severity':'warning','count':count})

    now = int(checked_at if checked_at is not None else (health.get('checked_at') or time.time()))
    recent_count = sum(1 for row in api_errors if int(row.get('at') or 0) >= now - _RECENT_ERROR_SECONDS)
    if recent_count:
        issues.append({'code':'recent_api_errors','severity':'warning','count':recent_count})

    failed_checks = [check for check in (deployment or {}).get('checks', []) if not check.get('ok')]
    if failed_checks:
        severity = 'critical' if any(check.get('severity')=='critical' for check in failed_checks) else 'warning'
        issues.append({'code':'deployment_configuration','severity':severity,'count':len(failed_checks)})

    level = 'critical' if any(issue['severity']=='critical' for issue in issues) else 'warning' if issues else 'healthy'
    return {'level':level,'issues':issues,'checked_at':now}


def clear_api_errors() -> None:
    """Test helper; production diagnostics are cleared only by process restart."""
    with _lock:
        _errors.clear()
