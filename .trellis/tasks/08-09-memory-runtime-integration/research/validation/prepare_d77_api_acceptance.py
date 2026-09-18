"""Copy the clean stopped acceptance target, preserving all earlier evidence."""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import subprocess
from pathlib import Path

from d77_siliconflow_api import HELPERS, ROOT, SOURCE, digest, event, private_json
from prepare_d77_owner_acceptance import PG_BIN, original_files, require_plain
from real_hindsight_environment import credentials, crypt_bytes


def source_files() -> dict[str, dict[str, str | int]]:
    paths = [
        SOURCE / "validation.sqlite",
        SOURCE / "validation.sqlite-wal",
        SOURCE / "validation.sqlite-shm",
    ]
    paths.extend(sorted((SOURCE / "native/data").rglob("*")))
    return {
        str(path.relative_to(SOURCE)): {
            "bytes": path.stat().st_size,
            "sha256": digest(path),
        }
        for path in paths
        if path.is_file()
    }


def backup(source: Path, target: Path) -> None:
    if target.exists():
        raise RuntimeError("D77_API_COPY_EXISTS")
    with sqlite3.connect(source.as_uri() + "?mode=ro&immutable=1", uri=True) as origin:
        with sqlite3.connect(target) as destination:
            origin.backup(destination)
            assert destination.execute("PRAGMA quick_check").fetchall() == [("ok",)]
            assert not destination.execute("PRAGMA foreign_key_check").fetchall()


def main() -> None:
    for path in (ROOT, SOURCE, SOURCE / "native/data"):
        require_plain(path)
    if (ROOT / "preparation-result.json").exists() or (ROOT / "native").exists():
        raise RuntimeError("D77_API_PREPARATION_ALREADY_EXISTS")
    owner = json.loads((SOURCE / "native/ownership.json").read_text(encoding="utf-8"))
    assert owner["stopped"] is True and Path(owner["root"]) == SOURCE / "native"
    assert owner["name"] == "taki-d78-real-" + SOURCE.name
    assert not (SOURCE / "native/data/postmaster.pid").exists()
    assert (SOURCE / "validation.sqlite-wal").stat().st_size == 0
    control = subprocess.run(
        [str(PG_BIN / "pg_controldata.exe"), str(SOURCE / "native/data")],
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, "LC_ALL": "C", "LANG": "C"},
        creationflags=subprocess.CREATE_NO_WINDOW,
    ).stdout
    assert re.search(r"Database cluster state:\s+shut down\s*$", control, re.MULTILINE)
    assert not any(
        path.lstat().st_file_attributes & 0x400
        for path in (SOURCE / "native/data").rglob("*")
    )
    user_before, prior_before = original_files(), source_files()
    private_json(
        "preservation-before.json",
        {"originalUserFiles": user_before, "sourceAcceptanceFiles": prior_before},
    )
    native = ROOT / "native"
    native.mkdir()
    shutil.copytree(SOURCE / "native/data", native / "data")
    backup(SOURCE / "validation.sqlite", ROOT / "validation.sqlite")
    for name in (
        "acceptance-master.key",
        "acceptance-secrets.bin",
        "native-response-loss-result.json",
        "d78-baseline-state.json",
    ):
        shutil.copy2(SOURCE / name, ROOT / name)
    private = credentials(SOURCE)
    copied = {
        "run_id": ROOT.name,
        "pg_password": private["pg_password"],
        "api_key": private["api_key"],
    }
    with (ROOT / "native-credentials.dpapi").open("xb") as stream:
        stream.write(crypt_bytes(json.dumps(copied).encode(), decrypt=False))
    http = json.loads((SOURCE / "http-owner.json").read_text(encoding="utf-8"))
    private_json("http-owner.json", {"run_id": ROOT.name, "port": http["port"]})
    name = "taki-d78-real-" + ROOT.name
    registry = Path(os.environ["USERPROFILE"]) / ".pg0/instances" / name
    assert not registry.exists()
    (native / "ownership.json").write_text(
        json.dumps(
            {
                "name": name,
                "root": str(native),
                "registry": str(registry),
                "started": False,
                "stopped": True,
                "credential_rotated": True,
                "clonedFromStoppedRun": SOURCE.name,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    assert source_files() == prior_before and original_files() == user_before
    private_json(
        "preparation-result.json",
        {
            "runId": ROOT.name,
            "sourceRun": SOURCE.name,
            "priorCleanlyStopped": True,
            "sourceAndOriginalUnchanged": True,
            "sourceManifestFiles": len(prior_before),
            "databaseSha256": digest(ROOT / "validation.sqlite"),
            "helpers": str(HELPERS),
            "modelsCalled": False,
        },
    )
    event(
        "API_ACCEPTANCE_COPY_PREPARED",
        sourceFilesUnchanged=True,
        originalFilesUnchanged=True,
    )


if __name__ == "__main__":
    main()
