"""Private environment and credentials for the owner-approved D78 actual-data test.

Only model settings are read from the established native configuration. The DB and
HTTP credentials are new, per-run values; neither user connection settings nor
fixture model settings are inherited. Secrets never enter subprocess arguments.
"""

from __future__ import annotations

import ctypes
import json
import msvcrt
import os
import secrets
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from ctypes import wintypes
from pathlib import Path
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
TAKI_ROOT = SCRIPT_DIR.parents[4]
NATIVE_ROOT = Path("H:/hindsight")
PYTHON = NATIVE_ROOT / ".venv/Scripts/python.exe"
EXPECTED_ROOT = Path("H:/TakiAgent/.trellis/.runtime/d78-real-data/06acadec47e7")
RETEST_ROOT = Path("H:/TakiAgent/.trellis/.runtime/d78-real-data/cd01c5453b1e")
SUPERVISED_RETEST_ROOT = Path("H:/TakiAgent/.trellis/.runtime/d78-real-data/654131f0175a")


def owned_root(value: str) -> Path:
    root = Path(os.path.abspath(value))
    if root not in (EXPECTED_ROOT, RETEST_ROOT, SUPERVISED_RETEST_ROOT):
        raise RuntimeError("D78_REAL_ROOT_REFUSED")
    # Inspect lexical ancestors before resolving: resolving both paths would
    # silently bless a junction from the named run directory to outside storage.
    for path in (root, *root.parents):
        if path.lstat().st_file_attributes & 0x400:
            raise RuntimeError("D78_REAL_ROOT_LINK_REFUSED")
    if root.resolve(strict=True) != root:
        raise RuntimeError("D78_REAL_ROOT_REFUSED")
    if not (root / "validation.sqlite").is_file():
        raise RuntimeError("D78_REAL_COPY_MISSING")
    return root


@contextmanager
def exclusive_supervisor(root: Path) -> Iterator[None]:
    """An OS byte-range lock survives no process and cannot be stolen by a second launcher."""
    path = root / "native-supervisor.lock"
    if path.exists() and (path.lstat().st_file_attributes & 0x400 or path.stat().st_nlink != 1):
        raise RuntimeError("D78_SUPERVISOR_LOCK_LINK_REFUSED")
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(descriptor, "r+b") as lock:
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as error:
            raise RuntimeError("D78_SUPERVISOR_ALREADY_RUNNING") from error
        try:
            lock.write(b"\0" + json.dumps({"pid": os.getpid(), "root": str(root)}).encode("utf-8"))
            lock.truncate()
            lock.flush()
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def clean_environment(root: Path) -> dict[str, str]:
    # USERNAME is needed by getpass on Windows. Dropping it makes torch's cache
    # initialization fall back to the unavailable Unix pwd module.
    allowed = {
        "PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "USERPROFILE",
        "USERNAME", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA",
        "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
    }
    result = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    result.update({
        "PYTHON_DOTENV_DISABLED": "1", "PYTHONUTF8": "1", "UV_NO_ENV_FILE": "1",
        "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
        "DO_NOT_TRACK": "1", "TOKENIZERS_PARALLELISM": "false",
        # httpx otherwise discovers the Windows registry proxy even when proxy
        # environment variables were cleared. Use direct access to the reviewed
        # provider and owned loopback services; the socket guard remains in force.
        "NO_PROXY": "api.deepseek.com,127.0.0.1,localhost,::1",
        "TORCHINDUCTOR_CACHE_DIR": str(root / "torch-cache"),
        "PYTHONPATH": os.pathsep.join([str(SCRIPT_DIR), str(NATIVE_ROOT / "hindsight-api-slim")]),
    })
    return result


def model_environment(root: Path) -> dict[str, str]:
    keys = [f"HINDSIGHT_API_{prefix}LLM_{suffix}"
            for prefix in ("", "RETAIN_", "REFLECT_", "CONSOLIDATION_")
            for suffix in ("PROVIDER", "MODEL", "API_KEY", "BASE_URL")]
    keys += [f"HINDSIGHT_API_{prefix}_{suffix}"
             for prefix in ("EMBEDDINGS", "RERANKER")
             for suffix in ("PROVIDER", "LOCAL_MODEL", "LOCAL_FORCE_CPU", "LOCAL_TRUST_REMOTE_CODE")]
    script = """
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const [path, encodedKeys] = process.argv.slice(1);
const parsed = parseEnv(readFileSync(path, 'utf8'));
const keys = JSON.parse(encodedKeys);
process.stdout.write(JSON.stringify(Object.fromEntries(keys.filter(k => parsed[k]?.trim()).map(k => [k, parsed[k]]))));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(NATIVE_ROOT / ".env"), json.dumps(keys)],
        env=clean_environment(root), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW, check=False,
    )
    if result.returncode:
        raise RuntimeError("D78_MODEL_CONFIG_READ_FAILED")
    configured = json.loads(result.stdout)
    if not configured.get("HINDSIGHT_API_LLM_API_KEY"):
        raise RuntimeError("D78_MODEL_CREDENTIAL_MISSING")
    # This acceptance uses the already inspected provider and real cached local
    # models. A configuration change requires a fresh explicit target review.
    if (configured.get("HINDSIGHT_API_LLM_PROVIDER") != "openai"
            or configured.get("HINDSIGHT_API_LLM_MODEL") != "deepseek-v4-flash"):
        raise RuntimeError("D78_MODEL_CONFIG_CHANGED")
    url = urlparse(configured.get("HINDSIGHT_API_LLM_BASE_URL", ""))
    if url.scheme != "https" or url.hostname != "api.deepseek.com" or url.port not in (None, 443):
        raise RuntimeError("D78_MODEL_ENDPOINT_CHANGED")
    for prefix in ("EMBEDDINGS", "RERANKER"):
        if configured.get(f"HINDSIGHT_API_{prefix}_PROVIDER", "local") != "local":
            raise RuntimeError("D78_LOCAL_MODEL_CONFIG_CHANGED")
        if configured.get(f"HINDSIGHT_API_{prefix}_LOCAL_TRUST_REMOTE_CODE", "false").lower() not in ("false", "0"):
            raise RuntimeError("D78_LOCAL_REMOTE_CODE_REFUSED")
    environment = clean_environment(root)
    environment.update(configured)
    environment["TAKI_D78_REAL_CHILD"] = "1"
    return environment


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def crypt_bytes(value: bytes, *, decrypt: bool) -> bytes:
    """Use the current Windows user's DPAPI; the inherited directory ACL is private."""
    source_buffer = ctypes.create_string_buffer(value)
    source = DataBlob(len(value), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_ubyte)))
    output = DataBlob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    crypt.CryptProtectData.argtypes = [ctypes.POINTER(DataBlob), wintypes.LPCWSTR, ctypes.POINTER(DataBlob),
                                      ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob)]
    crypt.CryptProtectData.restype = wintypes.BOOL
    crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(DataBlob), ctypes.c_void_p, ctypes.POINTER(DataBlob),
                                        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DataBlob)]
    crypt.CryptUnprotectData.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        success = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output))
    else:
        success = crypt.CryptProtectData(ctypes.byref(source), "Taki D78 owned validation", None,
                                        None, None, 1, ctypes.byref(output))
    if not success:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel.LocalFree(output.pbData)


def credentials(root: Path) -> dict[str, str]:
    path = root / "native-credentials.dpapi"
    if path.exists():
        value = json.loads(crypt_bytes(path.read_bytes(), decrypt=True))
        if value.get("run_id") != root.name:
            raise RuntimeError("D78_CREDENTIAL_OWNER_MISMATCH")
        return value
    value = {"run_id": root.name, "pg_password": secrets.token_urlsafe(40), "api_key": secrets.token_urlsafe(48)}
    with path.open("xb") as out:
        out.write(crypt_bytes(json.dumps(value).encode("utf-8"), decrypt=False))
    return value
