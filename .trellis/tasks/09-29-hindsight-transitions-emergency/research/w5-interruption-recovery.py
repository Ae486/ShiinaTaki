"""Reconcile the abandoned owned supervisor after external process interruption.

Only the existing W5 working PostgreSQL copy is crash-recovered. Preserve its
SQLite/WAL and supervisor evidence before opening either database; no engine or
model is loaded. PostgreSQL itself handles its stale lock file.
"""
import asyncio
import ctypes
import hashlib
import importlib.util
import json
import shutil
import socket
import sqlite3
import subprocess
import sys
import uuid
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("w5_owner", HERE / "w5-reused-native.py")
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


async def audit_native(password):
    import asyncpg

    conn = await asyncpg.connect(host="127.0.0.1", port=owner.PG_PORT, user="taki_real", password=password, database="taki_real")
    try:
        await conn.execute("SET default_transaction_read_only=on")
        assert Path(await conn.fetchval("SHOW data_directory")).resolve() == (owner.ROOT / "data").resolve()
        current = await owner.completed_maintenance(conn)
        before = json.loads((owner.ROOT / "run-before-completed.json").read_text(encoding="utf-8"))
        for name, values in before.items():
            assert not (Counter(values) - Counter(current[name])), "COMPLETED_NATIVE_WORK_CHANGED"
        rows = await conn.fetch("SELECT bank_id,phase,proof IS NOT NULL AS proven,outcome IS NOT NULL AS terminal "
                                "FROM memory_transition_requests WHERE transition_id=$1 ORDER BY bank_id",
                                uuid.UUID("df47f32c-48a8-47bc-9792-2e24e8642084"))
        return {"completedFingerprints": current, "preservedSteps": len(before["steps"]),
                "preservedActions": len(before["actions"]), "currentSteps": len(current["steps"]),
                "currentActions": len(current["actions"]), "banks": [dict(row) for row in rows]}
    finally:
        await conn.close()


def main():
    root = owner.ROOT
    prior = json.loads((root / "ownership.json").read_text(encoding="utf-8"))
    assert prior["attemptId"] == "4607814624c74487b28d4d52ca04174a"
    assert prior["root"] == str(root) and prior["source"] == str(owner.SOURCE)
    assert not prior["stopped"], "Only the interrupted ownership record may be reconciled"
    for port in (owner.PG_PORT, owner.HTTP_PORT):
        with socket.socket() as probe:
            assert probe.connect_ex(("127.0.0.1", port)) != 0, "Owned service is still listening"
    status = subprocess.run([str(owner.inspection.PG_CTL), "-D", str(root / "data"), "status"],
                            capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW, check=False)
    assert status.returncode == 3
    pid_file = root / "data/postmaster.pid"
    if pid_file.exists():
        pid = int(pid_file.read_text().splitlines()[0])
        # Query only: an existing/reused PID needs review, never a blind kill or lock-file deletion.
        kernel = ctypes.windll.kernel32
        kernel.OpenProcess.restype = ctypes.c_void_p
        process = kernel.OpenProcess(0x1000, False, pid)
        if process:
            kernel.CloseHandle(ctypes.c_void_p(process))
            raise RuntimeError("RECORDED_POSTMASTER_PID_STILL_EXISTS")
    owner.source_verified()
    tag = "interruption-recovery-" + uuid.uuid4().hex
    retained = root / "attempt-history" / tag
    retained.mkdir()
    for name in ("ownership.json", "run-result.json", "run-native.log", "run-failure.log", "driver-result.json",
                 "driver-progress.json", "driver-node.log", "driver-failure.log", "run-before-completed.json",
                 "run-before-tables.json", "model-submissions.json", "application.sqlite", "application.sqlite-wal",
                 "application.sqlite-shm", "postgres.log"):
        if (root / name).exists():
            shutil.copy2(root / name, retained / name)
    if pid_file.exists():
        shutil.copy2(pid_file, retained / "postmaster.pid")
    sqlite_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob("application.sqlite*")}
    db = sqlite3.connect((root / "application.sqlite").as_uri() + "?mode=ro", uri=True)
    try:
        core = {"integrity": db.execute("PRAGMA integrity_check").fetchone()[0],
                "receipts": db.execute("SELECT count(*) FROM memory_transition_receipts").fetchone()[0],
                "abortCommands": db.execute("SELECT count(*) FROM memory_transition_native_commands WHERE slot LIKE 'abort:%'").fetchone()[0],
                "migration": db.execute("SELECT max(version) FROM migrations").fetchone()[0]}
        assert core["integrity"] == "ok"
    finally:
        db.close()
    sys.path.insert(0, str(owner.VALIDATION))
    from real_hindsight_environment import crypt_bytes
    private = json.loads(crypt_bytes((owner.inspection.HISTORY / "native-credentials.dpapi").read_bytes(), decrypt=True))
    result = {"interruptedAttemptId": prior["attemptId"], "modelRequests": 0, "started": False,
              "stopped": False, "core": core, "sqlitePreimageHashes": sqlite_hashes}
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
        result["submitted"] = json.loads((root / "model-submissions.json").read_text())["submitted"]
        owner.inspection.write_json(root / (tag + ".json"), result)
        if result["stopped"] and "native" in result and result["sourceUnchanged"]:
            owner.inspection.write_json(root / "ownership.json", prior | {"stopped": True,
                "interrupted": True, "interruptionAudit": tag + ".json"})
        public = result | {"native": {k: v for k, v in result.get("native", {}).items() if k != "completedFingerprints"}}
        print(json.dumps({"file": str(root / (tag + ".json")), **public}), flush=True)
    assert result["stopped"] and result["sourceUnchanged"] and result["submitted"] == 276


if __name__ == "__main__":
    main()
