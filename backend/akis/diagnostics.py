"""Small, process-local operational diagnostics safe to expose to system admins.

The buffer deliberately contains no exception messages, request bodies, query strings,
headers or user identifiers. It is bounded and disappears whenever the API restarts.
"""
from collections import deque
from threading import Lock
import re
import time

_MAX_ERRORS = 20
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


def clear_api_errors() -> None:
    """Test helper; production diagnostics are cleared only by process restart."""
    with _lock:
        _errors.clear()
