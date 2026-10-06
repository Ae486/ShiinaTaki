"""Inspect/upgrade an owned physical copy of already-converted real memory.

No Hindsight engine or model is started. All old table columns/rows are hashed
before and after the actual native migration, excluding the version marker.
Original data and the private physical baseline remain stopped and unchanged.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import traceback
import uuid
from pathlib import Path

REPO = Path("H:/TakiAgent")
NATIVE = Path("H:/hindsight")
HERE = Path(__file__).resolve().parent
HISTORY = REPO / ".trellis/.runtime/d78-real-data/654131f0175a"
BASELINE = REPO / ".trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90"
PG_CTL = Path("C:/Users/55473/.pg0/installation/18.1.0/bin/pg_ctl.exe")
PG0 = NATIVE / ".venv/Lib/site-packages/pg0/bin/pg0.exe"


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def clean_environment() -> None:
    allowed = {"PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "USERPROFILE", "USERNAME",
               "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"}
    retained = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    os.environ.clear()
    os.environ.update(retained)
    os.environ.update(PYTHON_DOTENV_DISABLED="1", UV_NO_ENV_FILE="1", PYTHONUTF8="1",
                      HINDSIGHT_API_LLM_PROVIDER="mock", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")


def check_baseline() -> None:
    for entry in json.loads((BASELINE / "files.json").read_text(encoding="utf-8")):
        path = BASELINE / "data" / entry["path"]
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise RuntimeError("BASELINE_BYTES_CHANGED")
    info = subprocess.run([str(PG0), "info", "--name", "taki-d78-real-654131f0175a", "--output", "json"],
                          capture_output=True, text=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    value = json.loads(info.stdout)
    if value["running"] or Path(value["data_dir"]).resolve() != (HISTORY / "native/data").resolve():
        raise RuntimeError("HISTORICAL_INSTANCE_NOT_STOPPED")


def command(root: Path, args: list[str], label: str) -> int:
    with (root / f"{label}.log").open("w", encoding="utf-8") as output:
        return subprocess.run(args, stdin=subprocess.DEVNULL, stdout=output, stderr=output, timeout=60,
                              creationflags=subprocess.CREATE_NO_WINDOW, check=False).returncode


def quote(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


async def snapshot(conn, original: list[dict] | None = None) -> list[dict]:
    if original is None:
        rows = await conn.fetch("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' "
                                "AND schemaname<>'information_schema' ORDER BY schemaname,tablename")
        original = []
        for row in rows:
            columns = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 "
                                       "AND table_name=$2 ORDER BY ordinal_position", row["schemaname"], row["tablename"])
            original.append({"schema": row["schemaname"], "table": row["tablename"],
                             "columns": [column["column_name"] for column in columns]})
    result = []
    for item in original:
        selection = ",".join(quote(column) for column in item["columns"])
        table = quote(item["schema"]) + "." + quote(item["table"])
        values = await conn.fetch(f"SELECT to_jsonb(t)::text AS value FROM (SELECT {selection} FROM {table}) t")
        digest = hashlib.sha256()
        for value in sorted(row["value"] for row in values):
            encoded = value.encode("utf-8")
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
        result.append({**item, "rows": len(values), "sha256": digest.hexdigest()})
    return result


async def inspect(root: Path, port: int, password: str, upgrade: bool) -> dict:
    import asyncpg
    conn = await asyncpg.connect(host="127.0.0.1", port=port, user="taki_real", password=password,
                                 database="taki_real", timeout=10)
    try:
        if Path(await conn.fetchval("SHOW data_directory")).resolve() != (root / "data").resolve():
            raise RuntimeError("WORKING_DATABASE_IDENTITY_MISMATCH")
        before = await snapshot(conn)
        write_json(root / "before-tables.json", before)
        versions = [row for row in before if row["table"] == "alembic_version"]
        heads_before = {}
        for row in versions:
            heads_before[row["schema"]] = list(await conn.fetchval(
                f"SELECT array_agg(version_num ORDER BY version_num) FROM {quote(row['schema'])}.alembic_version"))
        if upgrade:
            from sqlalchemy import URL
            from hindsight_api.migrations import run_migrations
            url = URL.create("postgresql", username="taki_real", password=password, host="127.0.0.1",
                             port=port, database="taki_real").render_as_string(hide_password=False)
            for schema in heads_before:
                await asyncio.to_thread(run_migrations, url, schema=schema)
        after = await snapshot(conn, before)
        write_json(root / "after-original-columns.json", after)
        changed = [f"{old['schema']}.{old['table']}" for old, new in zip(before, after, strict=True)
                   if old != new and old["table"] != "alembic_version"]
        current = await snapshot(conn)
        write_json(root / "current-tables.json", current)
        heads_after = {}
        for schema in heads_before:
            heads_after[schema] = list(await conn.fetchval(
                f"SELECT array_agg(version_num ORDER BY version_num) FROM {quote(schema)}.alembic_version"))
        if changed:
            raise RuntimeError("ORIGINAL_TABLE_CONTENT_CHANGED:" + ",".join(changed))
        return {"headsBefore": heads_before, "headsAfter": heads_after, "originalTables": len(before),
                "originalColumnsAndRowsUnchanged": True,
                "tables": {f"{row['schema']}.{row['table']}": row["rows"] for row in current}}
    finally:
        await conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upgrade", action="store_true")
    args = parser.parse_args()
    clean_environment()
    check_baseline()
    root = BASELINE / ("working-" + uuid.uuid4().hex)
    root.mkdir()  # Inherits the baseline's current-user/SYSTEM-only directory ACL.
    shutil.copytree(BASELINE / "data", root / "data")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    os.environ.update(TAKI_SMOKE_ALLOWED_PORTS=str(port), TAKI_SMOKE_EGRESS_LOG=str(root / "egress.jsonl"))
    sys.path[:0] = [str(HERE / "native-test-support"), str(NATIVE / "hindsight-api-slim"),
                   str(REPO / ".trellis/tasks/08-09-hindsight-initial-cutover/research/validation")]
    from egress_guard import install_guard
    from real_hindsight_environment import crypt_bytes
    sys.modules["winloop"] = None
    install_guard()
    private = json.loads(crypt_bytes((HISTORY / "native-credentials.dpapi").read_bytes(), decrypt=True))
    if private.get("run_id") != HISTORY.name:
        raise RuntimeError("HISTORICAL_CREDENTIAL_IDENTITY_MISMATCH")
    summary = {"root": str(root), "port": port, "baseline": str(BASELINE), "upgradeRequested": args.upgrade,
               "conversionExecuted": False, "llmCalls": 0, "started": False, "stopped": False}
    write_json(root / "ownership.json", summary)
    try:
        # pg_ctl's Windows command parsing preserves single quotes literally.
        # An empty assignment disables optional preloads without naming a library.
        options = f"-p {port} -h 127.0.0.1 -c shared_preload_libraries= -c lc_messages=C -c autovacuum=off"
        if command(root, [str(PG_CTL), "-D", str(root / "data"), "-l", str(root / "postgres.log"),
                          "-o", options, "-w", "-t", "30", "start"], "start") != 0:
            raise RuntimeError("OWNED_POSTGRES_START_FAILED")
        summary["started"] = True
        write_json(root / "ownership.json", summary)
        summary["database"] = asyncio.run(inspect(root, port, private["pg_password"], args.upgrade))
    except BaseException as error:
        summary["errorType"] = type(error).__name__
        (root / "failure.log").write_text(traceback.format_exc(), encoding="utf-8")
    finally:
        stopped = command(root, [str(PG_CTL), "-D", str(root / "data"), "-m", "fast", "-w", "-t", "30", "stop"], "stop") == 0
        if not stopped:
            status = command(root, [str(PG_CTL), "-D", str(root / "data"), "status"], "status")
            stopped = status == 3 and not (root / "data/postmaster.pid").exists()
        summary["stopped"] = stopped
        check_baseline()
        summary["baselineUnchangedAndOriginalStopped"] = True
        write_json(root / "result.json", summary)
        write_json(root / "ownership.json", summary)
        print(json.dumps({key: value for key, value in summary.items() if key != "database"}))
        if "database" in summary:
            print(json.dumps(summary["database"]))
    return 0 if summary["stopped"] and "errorType" not in summary else 1


if __name__ == "__main__":
    raise SystemExit(main())
