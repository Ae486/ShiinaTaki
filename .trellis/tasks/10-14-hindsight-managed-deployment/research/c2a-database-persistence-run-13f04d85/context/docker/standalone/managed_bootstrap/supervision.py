"""Own a fixed consumer's process lifetime independently of admission deadlines.

C1b supplies no Native release command or provider mapping. The only caller that
creates a child today is the dedicated fake consumer in the process fixtures.
"""

from __future__ import annotations

import ctypes
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from .protocol import SHUTDOWN_SECONDS, Reason, Refusal


def clean_environment(runtime_directory: Path) -> dict[str, str]:
    """Drop ambient credentials, dotenv, Python hooks and provider configuration."""
    environment = {
        "PYTHON_DOTENV_DISABLED": "true",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUNBUFFERED": "1",
        "PYTHONNOUSERSITE": "1",
        "HOME": str(runtime_directory),
        "TMP": str(runtime_directory),
        "TEMP": str(runtime_directory),
    }
    # Windows needs its OS directory for interpreter/loader operation. No PATH,
    # user site, provider or application environment is inherited implicitly.
    if sys.platform == "win32":
        for name in ("SystemRoot", "WINDIR"):
            if name in os.environ:
                environment[name] = os.environ[name]
    return environment


def enable_linux_reaping() -> None:
    """Make a non-PID1 Linux fixture adopt and reap its owned grandchildren."""
    if sys.platform != "linux":
        raise Refusal(Reason.UNSUPPORTED)
    libc = ctypes.CDLL(None, use_errno=True)
    prctl = libc.prctl
    prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    prctl.restype = ctypes.c_int
    # PR_SET_CHILD_SUBREAPER is process-local; no service/OS installation occurs.
    if prctl(36, 1, 0, 0, 0) != 0:
        raise Refusal(Reason.UNSUPPORTED)


class OwnedChild:
    """A direct child; Linux additionally owns its private session/process group.

    The caller must use DEVNULL for all child stdio and start_new_session=True
    on Linux. There is no wire/CLI path to choose commands or an environment map.
    Windows fixtures have a leaf child only and claim no Linux group evidence.
    """

    def __init__(self, process: subprocess.Popen[bytes]) -> None:
        self.process = process
        self._group = sys.platform == "linux"
        self._closed = False
        if self._group and getattr(os, "getpgid")(process.pid) != process.pid:
            process.kill()
            process.wait()
            raise Refusal(Reason.UNSAFE)

    def poll(self) -> int | None:
        return self.process.poll()

    def _signal_group(self, signum: int) -> None:
        try:
            getattr(os, "killpg")(self.process.pid, signum)
        except ProcessLookupError:
            pass  # The exact owned group has already terminated.

    def _group_alive(self) -> bool:
        try:
            getattr(os, "killpg")(self.process.pid, 0)
            return True
        except ProcessLookupError:
            return False

    def _reap_adopted(self) -> None:
        # Popen remains the only reaper of the direct child. After it exits, a
        # PID1/subreaper may reap only adopted members of that child's group.
        if self.process.poll() is None:
            return
        while True:
            try:
                reaped = os.waitpid(-self.process.pid, os.WNOHANG)
            except ChildProcessError:
                return
            if reaped[0] == 0:
                return

    def stop(self) -> None:
        if self._closed:
            return
        self._closed = True
        if not self._group:
            self._stop_leaf()
            return
        self._signal_group(signal.SIGTERM)
        deadline = time.monotonic() + SHUTDOWN_SECONDS
        while time.monotonic() < deadline:
            self._reap_adopted()
            if not self._group_alive():
                self.process.wait()
                return
            time.sleep(0.02)
        self._signal_group(signal.SIGKILL)
        self.process.wait(timeout=5)
        reap_deadline = time.monotonic() + 5
        while self._group_alive() and time.monotonic() < reap_deadline:
            self._reap_adopted()
            time.sleep(0.02)
        if self._group_alive():
            raise Refusal(Reason.UNKNOWN)

    def _stop_leaf(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
        try:
            self.process.wait(timeout=SHUTDOWN_SECONDS)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
