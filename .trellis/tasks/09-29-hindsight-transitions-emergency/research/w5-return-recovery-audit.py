"""Inspect the stopped owned RETURN pair and preserve original completed-work evidence; zero models."""
from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
import sqlite3
import sys
import uuid
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("w5_return_owner", HERE / "w5-reused-native.py")
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


async def audit_native(password: str) -> dict:
    import asyncpg
    conn = await asyncpg.connect(host="127.0.0.1", port=owner.PG_PORT, user="taki_real", password=password, database="taki_real")
    try:
        await conn.execute("SET default_transaction_read_only=on")
        assert Path(await conn.fetchval("SHOW data_directory")).resolve() == (owner.ROOT / "data").resolve()
        before = json.loads((owner.ROOT / "run-before-completed.json").read_text(encoding="utf-8"))
        current = await owner.completed_maintenance(conn)
        for name, values in before.items():
            assert not (Counter(values) - Counter(current[name])), "COMPLETED_NATIVE_WORK_CHANGED"
        plans = await conn.fetch("SELECT bank_id,state,candidate_hash,required_set_hash FROM memory_transition_maintenance ORDER BY bank_id")
        return {"preservedCompletedSteps": len(before["steps"]), "preservedActions": len(before["actions"]),
                "currentCompletedSteps": len(current["steps"]), "currentActions": len(current["actions"]),
                "plans": [dict(row) for row in plans], "completedFingerprints": current}
    finally:
        await conn.close()


def audit_core() -> dict:
    path = owner.ROOT / "application.sqlite"
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    db = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    try:
        result = {"migration": db.execute("SELECT max(version) FROM migrations").fetchone()[0],
                  "receipts": db.execute("SELECT count(*) FROM memory_transition_receipts").fetchone()[0],
                  "commands": dict(db.execute("SELECT kind,count(*) FROM memory_transition_native_commands GROUP BY kind").fetchall()),
                  "abortCommands": db.execute("SELECT count(*) FROM memory_transition_native_commands WHERE slot LIKE 'abort:%'").fetchone()[0],
                  "integrity": db.execute("PRAGMA integrity_check").fetchone()[0]}
    finally:
        db.close()
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    return result | {"sha256": before}


def main() -> None:
    owner.source_verified()
    root = owner.ROOT
    assert json.loads((root / "ownership.json").read_text(encoding="utf-8"))["stopped"]
    assert not (root / "data/postmaster.pid").exists()
    sys.path.insert(0, str(owner.VALIDATION))
    from real_hindsight_environment import crypt_bytes
    private = json.loads(crypt_bytes((owner.inspection.HISTORY / "native-credentials.dpapi").read_bytes(), decrypt=True))
    tag = "return-audit-" + uuid.uuid4().hex
    result = {"modelRequests": 0, "started": False, "stopped": False, "core": audit_core()}
    try:
        assert owner.inspection.command(root, [str(owner.inspection.PG_CTL), "-D", str(root / "data"),
            "-l", str(root / (tag + "-postgres.log")), "-o", f"-p {owner.PG_PORT} -h 127.0.0.1 -c shared_preload_libraries= -c lc_messages=C -c autovacuum=off",
            "-w", "-t", "30", "start"], tag + "-start") == 0
        result["started"] = True
        result["native"] = asyncio.run(audit_native(private["pg_password"]))
    finally:
        if result["started"]:
            result["stopped"] = owner.inspection.command(root, [str(owner.inspection.PG_CTL), "-D", str(root / "data"),
                "-m", "fast", "-w", "-t", "30", "stop"], tag + "-stop") == 0
        result["sourceUnchanged"] = bool(owner.source_verified())
        destination = root / (tag + ".json")
        owner.inspection.write_json(destination, result)
        summary = {key: value for key, value in result.items() if key != "native"}
        summary["native"] = {key: value for key, value in result.get("native", {}).items() if key not in {"plans", "completedFingerprints"}}
        print(json.dumps({"file": str(destination), **summary}), flush=True)
    assert result["stopped"] and result["sourceUnchanged"]


if __name__ == "__main__":
    main()
