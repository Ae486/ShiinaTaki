"""Prepare private actual-data copies without opening a writable original database."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TAKI = Path("H:/TakiAgent")
ROOT = TAKI / ".trellis/.runtime/d77-acceptance/9e41c8d27fa0"
PRIOR = TAKI / ".trellis/.runtime/d78-real-data/654131f0175a"
SOURCE = Path("C:/Users/55473/.takiagent/taki.db")
HELPERS = TAKI / ".trellis/tasks/08-09-hindsight-initial-cutover/research/validation"
PG_BIN = Path("C:/Users/55473/.pg0/installation/18.1.0/bin")


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def require_plain(path: Path) -> None:
    for item in (path, *path.parents):
        if item.exists() and item.lstat().st_file_attributes & 0x400:
            raise RuntimeError("D77_ACCEPTANCE_LINK_REFUSED")
    if path.resolve() != path:
        raise RuntimeError("D77_ACCEPTANCE_PATH_REFUSED")


def readonly(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    connection.execute("PRAGMA query_only=ON")
    return connection


def backup(source: Path, destination: Path) -> None:
    if destination.exists():
        raise RuntimeError("D77_ACCEPTANCE_COPY_EXISTS")
    with readonly(source) as origin:
        with sqlite3.connect(destination) as target:
            origin.backup(target)


def table_evidence(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {}
    with readonly(path) as connection:
        if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
            raise RuntimeError("D77_ACCEPTANCE_SQLITE_INTEGRITY")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("D77_ACCEPTANCE_SQLITE_FOREIGN_KEYS")
        for (name,) in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ):
            if not re.fullmatch(r"[a-zA-Z0-9_]+", name):
                raise RuntimeError("D77_ACCEPTANCE_TABLE_NAME")
            cursor = connection.execute(f'SELECT * FROM "{name}"')
            columns = [item[0] for item in cursor.description]
            rows = []
            for row in cursor:
                value = [
                    [key, ["blob", field.hex()] if isinstance(field, bytes) else field]
                    for key, field in zip(columns, row, strict=True)
                ]
                rows.append(json.dumps(value, ensure_ascii=True, separators=(",", ":")))
            encoded = json.dumps(sorted(rows), separators=(",", ":")).encode()
            result[name] = {
                "rows": len(rows),
                "sha256": hashlib.sha256(encoded).hexdigest(),
            }
    return result


def original_files() -> dict[str, Any]:
    return {
        path.name: {"bytes": path.stat().st_size, "sha256": digest(path)}
        for path in (SOURCE, Path(str(SOURCE) + "-wal"), Path(str(SOURCE) + "-shm"))
        if path.exists()
    }


def main() -> None:
    if ROOT.exists():
        raise RuntimeError("D77_ACCEPTANCE_ROOT_EXISTS")
    for path in (TAKI, ROOT, PRIOR, SOURCE):
        require_plain(path)
    ROOT.mkdir(parents=True)
    sid = subprocess.run(
        ["whoami", "/user", "/fo", "csv", "/nh"],
        check=True,
        capture_output=True,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    ).stdout
    match = re.search(r"S-1-5-[0-9-]+", sid)
    if not match:
        raise RuntimeError("D77_ACCEPTANCE_OWNER_UNKNOWN")
    subprocess.run(
        [
            "icacls",
            str(ROOT),
            "/inheritance:r",
            "/grant:r",
            f"*{match[0]}:(OI)(CI)F",
            "*S-1-5-18:(OI)(CI)F",
        ],
        check=True,
        capture_output=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    before = original_files()
    backup(SOURCE, ROOT / "source-snapshot.sqlite")
    current = table_evidence(ROOT / "source-snapshot.sqlite")
    prior = table_evidence(PRIOR / "source-snapshot.sqlite")
    changed = [
        name
        for name in sorted(current.keys() | prior.keys())
        if current.get(name) != prior.get(name)
    ]
    source_report = {
        "at": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE),
        "sourceOpenedReadOnly": True,
        "sourceFilesBefore": before,
        "sourceFilesAfter": original_files(),
        "snapshotSha256": digest(ROOT / "source-snapshot.sqlite"),
        "tables": current,
        "changedTablesSinceSuccessfulD78Input": changed,
    }
    (ROOT / "source-copy-summary.json").write_text(
        json.dumps(source_report, indent=2) + "\n", encoding="utf-8"
    )
    if changed:
        raise RuntimeError("D77_ACCEPTANCE_BASELINE_SOURCE_CHANGED")
    if before != original_files():
        raise RuntimeError("D77_ACCEPTANCE_SOURCE_CONCURRENTLY_CHANGED")

    # A physical copy is valid only after a clean PostgreSQL shutdown. Never run
    # recovery or migrations against the retained cluster to make it copyable.
    owner = json.loads((PRIOR / "native/ownership.json").read_text(encoding="utf-8"))
    old_data = PRIOR / "native/data"
    if (
        owner.get("stopped") is not True
        or Path(owner["root"]) != PRIOR / "native"
        or owner.get("name") != "taki-d78-real-" + PRIOR.name
        or (old_data / "postmaster.pid").exists()
    ):
        raise RuntimeError("D77_ACCEPTANCE_PRIOR_PG_NOT_STOPPED")
    pg_environment = {**os.environ, "LC_ALL": "C", "LANG": "C"}
    control = subprocess.run(
        [str(PG_BIN / "pg_controldata.exe"), str(old_data)],
        check=True,
        capture_output=True,
        text=True,
        env=pg_environment,
        creationflags=subprocess.CREATE_NO_WINDOW,
    ).stdout
    if not re.search(r"Database cluster state:\s+shut down\s*$", control, re.MULTILINE):
        raise RuntimeError("D77_ACCEPTANCE_PRIOR_PG_NOT_CLEAN")
    if any(
        path.is_symlink() or path.lstat().st_file_attributes & 0x400
        for path in old_data.rglob("*")
    ):
        raise RuntimeError("D77_ACCEPTANCE_PG_LINK_REFUSED")
    native = ROOT / "native"
    native.mkdir()
    shutil.copytree(old_data, native / "data")
    backup(PRIOR / "validation.sqlite", ROOT / "validation.sqlite")
    shutil.copy2(
        PRIOR / "current-cutover-real-data-state.json", ROOT / "d78-baseline-state.json"
    )

    sys.path.insert(0, str(HELPERS))
    from real_hindsight_environment import credentials, crypt_bytes, model_environment

    private = credentials(PRIOR)
    # This is a restore of a stopped test instance, including its authenticated
    # B3 connection. Keeping the actual credential and free old loopback port
    # preserves the genuine fingerprint without rewriting old proof receipts.
    copied = {
        "run_id": ROOT.name,
        "pg_password": private["pg_password"],
        "api_key": private["api_key"],
    }
    (ROOT / "native-credentials.dpapi").write_bytes(
        crypt_bytes(json.dumps(copied).encode(), decrypt=False)
    )
    http = json.loads((PRIOR / "http-owner.json").read_text(encoding="utf-8"))
    (ROOT / "http-owner.json").write_text(
        json.dumps({"run_id": ROOT.name, "port": http["port"]}) + "\n", encoding="utf-8"
    )
    name = "taki-d78-real-" + ROOT.name
    registry = Path(os.environ["USERPROFILE"]) / ".pg0/instances" / name
    if registry.exists():
        raise RuntimeError("D77_ACCEPTANCE_TARGET_REGISTRY_EXISTS")
    new_owner = {
        "name": name,
        "root": str(native),
        "registry": str(registry),
        "started": False,
        "stopped": True,
        "credential_rotated": True,
        "clonedFromStoppedRun": PRIOR.name,
    }
    (native / "ownership.json").write_text(
        json.dumps(new_owner, indent=2) + "\n", encoding="utf-8"
    )
    models = model_environment(ROOT)
    report = {
        "runId": ROOT.name,
        "priorRunId": PRIOR.name,
        "sourceUnchanged": True,
        "allSourceTablesMatch": True,
        "sourceTableCount": len(current),
        "priorPgCleanlyStopped": True,
        "nativeColdCopy": True,
        "workingCopySha256": digest(ROOT / "validation.sqlite"),
        "nativeFiles": sum(
            1 for item in (native / "data").rglob("*") if item.is_file()
        ),
        "model": models["HINDSIGHT_API_LLM_MODEL"],
        "endpoint": models["HINDSIGHT_API_LLM_BASE_URL"],
        "modelCalls": 0,
        "servicesStarted": False,
    }
    (ROOT / "preparation-result.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report))


if __name__ == "__main__":
    main()
