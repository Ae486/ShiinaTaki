"""INPUT: independently admitted fixed-slot credentials in private memory.
OUTPUT: one fixed fake child with private environment and safe PID evidence.
POS: managed_bootstrap C2a fixture consumer; no provider or Native API startup.
"""

from __future__ import annotations

import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from .protocol import Reason, Refusal, ResolvedCredentials, Slot, _json, uuid_string
from .supervision import OwnedChild, clean_environment, enable_linux_reaping

DATA_DIRECTORY = Path("/home/hindsight/.pg0")
FAKE_VALUE = re.compile(r"C2A_FAKE_[0-9a-f]{64}")
FAKE_ENVIRONMENT = {
    Slot.CONNECTION: "TAKI_C2A_FAKE_CONNECTION",
    Slot.DEFAULT: "TAKI_C2A_FAKE_DEFAULT",
    Slot.RETAIN: "TAKI_C2A_FAKE_RETAIN",
    Slot.REFLECT: "TAKI_C2A_FAKE_REFLECT",
    Slot.CONSOLIDATION: "TAKI_C2A_FAKE_CONSOLIDATION",
    Slot.EMBEDDING: "TAKI_C2A_FAKE_EMBEDDING",
    Slot.RERANKER: "TAKI_C2A_FAKE_RERANKER",
}


@dataclass(frozen=True)
class ChildMarker:
    pid: int
    startup_id: str
    state: str

    @staticmethod
    def read(path: Path) -> ChildMarker:
        with path.open("rb") as stream:
            value = _json(stream.read(1025), 1024)
        value.keys({"pid", "startupId", "state"})
        pid = value.member("pid")
        state = value.member("state")
        if type(pid) is not int or pid <= 0 or state not in ("running", "stopped"):
            raise Refusal(Reason.DENIED)
        return ChildMarker(pid, uuid_string(value.member("startupId")), str(state))


class C2FakeConsumer:
    def __init__(self, startup_id: str, root: Path = DATA_DIRECTORY) -> None:
        self.startup_id = startup_id
        self.root = root

    def __call__(self, credentials: ResolvedCredentials) -> OwnedChild:
        # This check is independent of the Host sender's pre-delivery check.
        # Never transform a real value into an acceptable fixture credential.
        if not credentials.entries or any(not FAKE_VALUE.fullmatch(entry.value) for entry in credentials.entries):
            raise Refusal(Reason.DENIED)
        environment = clean_environment(self.root)
        environment["TAKI_C2A_STARTUP_ID"] = self.startup_id
        for credential in credentials.entries:
            environment[FAKE_ENVIRONMENT[credential.slot]] = credential.value
        executable = sys.executable
        if sys.platform == "win32":
            # CPython's Windows venv executable is a redirector, so Popen.pid
            # would own that wrapper while the real leaf survived terminate().
            # Launch the same base interpreter directly with CPython's venv
            # handoff; the PID marker below proves the owned process is the leaf.
            executable = getattr(sys, "_base_executable", "")
            if not executable:
                raise Refusal(Reason.UNSUPPORTED)
            environment["__PYVENV_LAUNCHER__"] = sys.executable
        if sys.platform == "linux":
            enable_linux_reaping()
        try:
            process = subprocess.Popen(
                [executable, "-I", "-B", str(Path(__file__).with_name("fake_child.py"))],
                cwd=self.root,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=sys.platform == "linux",
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
        finally:
            environment.clear()
        owned = OwnedChild(process)
        try:
            # A successful Popen is not a running consumer. Wait for safe evidence
            # emitted only after the child's independent environment checks.
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and process.poll() is None:
                marker = self.root / "c2a-child.json"
                if marker.exists():
                    value = ChildMarker.read(marker)
                    if value == ChildMarker(process.pid, self.startup_id, "running"):
                        return owned
                time.sleep(0.02)
            raise Refusal(Reason.HOST)
        except BaseException:
            owned.stop()
            raise
