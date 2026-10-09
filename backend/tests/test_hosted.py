import signal
import subprocess
import sys

from akis.hosted import service_commands, stop_processes


def test_hosted_commands_include_api_worker_and_beat():
    commands = dict(service_commands({"QUEUE_MODE": "celery", "PORT": "8123"}))
    assert commands["api"][-2:] == ["8123", "--no-access-log"]
    assert "--pool=solo" in commands["worker"]
    assert "--concurrency=1" in commands["worker"]
    assert any(part.startswith("--schedule=/tmp/") for part in commands["beat"])


def test_non_celery_hosted_mode_only_starts_api():
    assert [name for name, _ in service_commands({"QUEUE_MODE": "local"})] == ["api"]


def test_stop_processes_terminates_child_process():
    process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], start_new_session=True)
    stop_processes([("test", process)], grace_seconds=2)
    assert process.poll() == -signal.SIGTERM
