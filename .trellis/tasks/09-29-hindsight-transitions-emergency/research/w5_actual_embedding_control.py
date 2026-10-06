"""Diagnostic-only process custody; importing this module never reads corpus data."""

from __future__ import annotations

import ctypes
import hashlib
import importlib.util
import json
import os
import socket
import subprocess
import sys
import time
from ctypes import wintypes
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
RUNTIME = HERE.parents[3] / ".trellis/.runtime"
PYTHON = Path("H:/hindsight/.venv/Scripts/python.exe")
PG_CTL = Path("C:/Users/55473/.pg0/installation/18.1.0/bin/pg_ctl.exe")
POSTGRES = PG_CTL.with_name("postgres.exe")
INIT_SECONDS = 180
OVERALL_SECONDS = 900
START_SETTLE_SECONDS = 45
MANIFEST = HERE / "w5-candidate-actual-embedding-source-manifest.json"
COMBINED_SHA = "5e0d006be9ddb2aece8e5b26df3002b2832c27f43dbeb4a9e999b162815bcbe0"
OFFLINE = {
    "PYTHON_DOTENV_DISABLED": "1",
    "UV_NO_ENV_FILE": "1",
    "PYTHONUTF8": "1",
    "HF_HUB_OFFLINE": "1",
    "TRANSFORMERS_OFFLINE": "1",
    "TOKENIZERS_PARALLELISM": "false",
    "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1",
}


def clean_environment(source: Any = None) -> dict[str, str]:
    """Same reviewed Windows/toolchain allowlist, with no provider/PG/cache override."""
    allowed = {
        "PATH",
        "PATHEXT",
        "COMSPEC",
        "SYSTEMROOT",
        "WINDIR",
        "USERPROFILE",
        "USERNAME",
        "TEMP",
        "TMP",
        "LOCALAPPDATA",
        "APPDATA",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
    }
    retained = {
        key: value for key, value in (os.environ if source is None else source).items() if key.upper() in allowed
    }
    return {**retained, **OFFLINE}


def child_environment(job: Path) -> dict[str, str]:
    # huggingface_hub reads its cached token before consulting the implicit-token
    # switch. Redirect only credential storage, leaving normal model caches and
    # actual device selection unchanged. Never create a token file.
    absent = job / "no-external-hf-credentials"
    assert not absent.exists(), "HF_CREDENTIAL_PATH_PRESENT"
    return {**clean_environment(), "HF_TOKEN_PATH": str(absent / "token")}


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def write_json(path: Path, value: Any) -> None:
    """A watchdog must never read a partially written pointer or phase event."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def verify_sources() -> None:
    assert digest(HERE / "w5-candidate-combined-source-manifest.json") == COMBINED_SHA
    manifest = read_json(MANIFEST)
    for row in manifest["files"]:
        path = Path(row["path"])
        assert path.stat().st_size == row["bytes"] and digest(path) == row["sha256"], "SOURCE_DRIFT"


class ProcessIdentity:
    """Query an exact live Windows handle; PID lookup alone is not custody."""

    def __init__(self, pid: int):
        if os.name != "nt":
            raise RuntimeError("WINDOWS_ONLY")
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.QueryFullProcessImageNameW.argtypes = [
            wintypes.HANDLE,
            wintypes.DWORD,
            wintypes.LPWSTR,
            ctypes.POINTER(wintypes.DWORD),
        ]
        self.kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.kernel.OpenProcess(0x1000 | 0x100000, False, pid)
        if not self.handle:
            raise RuntimeError("PROCESS_IDENTITY_UNAVAILABLE")
        try:
            if self.kernel.WaitForSingleObject(self.handle, 0) != 258:
                raise RuntimeError("PROCESS_NOT_LIVE")
            length = wintypes.DWORD(32768)
            buffer = ctypes.create_unicode_buffer(length.value)
            if not self.kernel.QueryFullProcessImageNameW(self.handle, 0, buffer, ctypes.byref(length)):
                raise RuntimeError("PROCESS_IMAGE_UNAVAILABLE")
            times = [wintypes.FILETIME() for _ in range(4)]
            if not self.kernel.GetProcessTimes(self.handle, *(ctypes.byref(stamp) for stamp in times)):
                raise RuntimeError("PROCESS_TIME_UNAVAILABLE")
            ticks = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
            self.value = {"pid": pid, "executable": str(Path(buffer.value).resolve()), "creationTicks": ticks}
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def validate_pointer(pointer: dict[str, Any]) -> Path:
    clone = Path(pointer["clone"]).resolve()
    assert clone.parent == RUNTIME.resolve() and clone.name.startswith("w5-candidate-native-clone-"), (
        "CLONE_PATH_REFUSED"
    )
    assert Path(pointer["data"]).resolve() == clone / "data", "PG_DATA_REFUSED"
    assert Path(pointer["postgres"]).resolve() == POSTGRES.resolve(), "PG_EXECUTABLE_REFUSED"
    assert 0 < pointer["port"] < 65536 and pointer["port"] not in {18495, 18496}, "PG_PORT_REFUSED"
    ownership = read_json(clone / "ownership.json")
    assert Path(ownership["data"]).resolve() == clone / "data" and ownership["port"] == pointer["port"]
    assert ownership["kind"] == "candidate-diagnostic-clone"
    return clone


def owned_pg(pointer: dict[str, Any], identity_factory: Any = ProcessIdentity) -> Any:
    clone = validate_pointer(pointer)
    pid_file = clone / "data/postmaster.pid"
    if not pid_file.exists():
        return None
    lines = pid_file.read_text(encoding="utf-8").splitlines()
    assert len(lines) >= 4 and Path(lines[1]).resolve() == clone / "data", "PG_PID_DATA_REFUSED"
    assert int(lines[3]) == pointer["port"], "PG_PID_PORT_REFUSED"
    process = identity_factory(int(lines[0]))
    try:
        assert Path(process.value["executable"]).resolve() == POSTGRES.resolve(), "PG_IMAGE_REFUSED"
        created = process.value["creationTicks"] / 10000000 - 11644473600
        assert abs(created - int(lines[2])) <= 3, "PG_PID_REUSED"
        if pointer.get("process") is not None:
            assert process.value == pointer["process"], "PG_PROCESS_REPLACED"
        assert pid_file.read_text(encoding="utf-8").splitlines() == lines, "PG_PID_CHANGED"
        return process
    except BaseException:
        process.close()
        raise


def port_released(port: int) -> bool:
    try:
        with socket.socket() as reservation:
            if os.name == "nt":
                reservation.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            reservation.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False


def cleanup_pg(
    pointer: dict[str, Any], *, inspect: Any = owned_pg, run: Any = subprocess.run, port_check: Any = port_released
) -> dict[str, Any]:
    """Refuse foreign identities before pg_ctl. Keep evidence on any failure."""
    result: dict[str, Any] = {"stopped": False, "portReleased": False, "attempts": []}
    try:
        clone = validate_pointer(pointer)
        for mode in ("fast", "immediate"):
            process = inspect(pointer)
            if process is None:
                result["stopped"] = True
                break
            try:
                # Keep the exact process handle live through pg_ctl's path-directed stop.
                code = run(
                    [str(PG_CTL), "-D", str(clone / "data"), "-m", mode, "-w", "-t", "30", "stop"],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=35,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    env=clean_environment(),
                    check=False,
                ).returncode
                result["attempts"].append({"mode": mode, "exitCode": code})
            except Exception as error:
                result["attempts"].append({"mode": mode, "errorClass": type(error).__name__})
            finally:
                process.close()
            if not (clone / "data/postmaster.pid").exists():
                result["stopped"] = True
                break
        result["portReleased"] = port_check(pointer["port"])
    except Exception as error:
        result["errorClass"] = type(error).__name__
    return result


def supervise(
    child: Any,
    phase_reader: Any,
    *,
    clock: Any = time.monotonic,
    sleep: Any = time.sleep,
    init_seconds: float = INIT_SECONDS,
    overall_seconds: float = OVERALL_SECONDS,
    record: Any = None,
) -> dict[str, Any]:
    """Independent monotonic watchdog: terminate only the held Popen handle."""
    started = clock()
    outcome: dict[str, Any] = {"timeout": None, "terminatedOwnedChild": False}
    while child.poll() is None:
        phase = phase_reader()
        now = clock()
        if now - started >= overall_seconds:
            outcome["timeout"] = "overall"
        elif phase.get("phase") == "initializing" and now - phase["monotonic"] >= init_seconds:
            outcome["timeout"] = "initialization"
        if outcome["timeout"]:
            if record is not None:
                record({**outcome, "elapsedSeconds": now - started})
            child.terminate()  # Popen retains the original Windows process handle; no PID search.
            outcome["terminatedOwnedChild"] = True
            if record is not None:
                record({**outcome, "elapsedSeconds": clock() - started})
            child.wait(timeout=10)
            break
        sleep(0.1)
    outcome.update(childExitCode=child.poll(), elapsedSeconds=clock() - started)
    if outcome["timeout"] is None and outcome["elapsedSeconds"] >= overall_seconds:
        outcome["timeout"] = "overall"
    if record is not None:
        record(outcome)
    return outcome
