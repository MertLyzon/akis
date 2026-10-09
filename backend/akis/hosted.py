"""Run the hosted API, queue worker and scheduler in one small container.

Docker Compose keeps these as separate services.  The hosted image uses this
supervisor because free-tier platforms may only allow two application services.
If any child exits, the whole container is stopped so the platform cannot report
a healthy API while scheduled publishing is no longer running.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence


def service_commands(environment: Mapping[str, str] | None = None) -> list[tuple[str, list[str]]]:
    env = os.environ if environment is None else environment
    python = sys.executable
    commands = [
        (
            "api",
            [
                python,
                "-m",
                "uvicorn",
                "akis.main:app",
                "--host",
                "0.0.0.0",
                "--port",
                env.get("PORT", "8000"),
                "--no-access-log",
            ],
        )
    ]
    if env.get("QUEUE_MODE", "celery").lower() == "celery":
        commands.extend(
            [
                (
                    "worker",
                    [
                        python,
                        "-m",
                        "celery",
                        "-A",
                        "akis.queue:celery",
                        "worker",
                        "--loglevel=warning",
                        "--pool=solo",
                        "--concurrency=1",
                    ],
                ),
                (
                    "beat",
                    [
                        python,
                        "-m",
                        "celery",
                        "-A",
                        "akis.queue:celery",
                        "beat",
                        "--loglevel=warning",
                        "--schedule=/tmp/akis-celerybeat-schedule",
                    ],
                ),
            ]
        )
    return commands


def stop_processes(processes: Sequence[tuple[str, subprocess.Popen]], grace_seconds: float = 10) -> None:
    for _, process in reversed(processes):
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                process.terminate()
    deadline = time.monotonic() + grace_seconds
    for _, process in reversed(processes):
        if process.poll() is not None:
            continue
        try:
            process.wait(timeout=max(0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                process.kill()


def main() -> int:
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "upgrade", "head"],
        check=True,
    )

    stopping = False
    received_signal = 0

    def request_stop(signum: int, _frame: object) -> None:
        nonlocal stopping, received_signal
        stopping = True
        received_signal = signum

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    processes: list[tuple[str, subprocess.Popen]] = []
    try:
        for name, command in service_commands():
            process = subprocess.Popen(command, start_new_session=True)
            processes.append((name, process))
            print(f"Hosted process started: {name} (pid={process.pid})", flush=True)

        while not stopping:
            for name, process in processes:
                code = process.poll()
                if code is not None:
                    print(f"Hosted process stopped unexpectedly: {name} (exit={code})", file=sys.stderr, flush=True)
                    return code or 1
            time.sleep(0.5)
        return 128 + received_signal
    finally:
        stop_processes(processes)


if __name__ == "__main__":
    raise SystemExit(main())
