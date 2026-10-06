"""Read the stopped W5 copy's durable native state without engine/model startup."""
from __future__ import annotations
import asyncio
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("w5_private_owner", HERE / "w5-reused-native.py")
owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)

async def read(password: str) -> dict:
    import asyncpg
    conn = await asyncpg.connect(host="127.0.0.1", port=owner.PG_PORT, user="taki_real", password=password, database="taki_real")
    try:
        await conn.execute("SET default_transaction_read_only=on")
        assert Path(await conn.fetchval("SHOW data_directory")).resolve() == (owner.ROOT / "data").resolve()
        requests = await conn.fetch("SELECT bank_id,transition_id,phase,generation,attempt_id,request_hash,lease_expires_at FROM memory_transition_requests ORDER BY bank_id")
        plans = await conn.fetch("SELECT bank_id,verification_id,state,revision,required_set_hash,candidate_hash FROM memory_transition_maintenance ORDER BY bank_id")
        steps = await conn.fetch("SELECT bank_id,verification_id,kind,state,count(*) AS count FROM memory_transition_steps GROUP BY bank_id,verification_id,kind,state ORDER BY bank_id,kind,state")
        actions = await conn.fetch("SELECT bank_id,verification_id,count(*) AS count FROM memory_transition_actions GROUP BY bank_id,verification_id ORDER BY bank_id")
        return {"requests": [dict(row) for row in requests], "plans": [dict(row) for row in plans],
                "steps": [dict(row) for row in steps], "actions": [dict(row) for row in actions]}
    finally:
        await conn.close()

def main() -> None:
    owner.source_verified()
    root = owner.ROOT; assert not (root / "data/postmaster.pid").exists()
    status = subprocess.run([str(owner.inspection.PG_CTL), "-D", str(root / "data"), "status"], capture_output=True,
                            creationflags=subprocess.CREATE_NO_WINDOW, check=False)
    assert status.returncode == 3
    sys.path.insert(0, str(owner.VALIDATION))
    from real_hindsight_environment import crypt_bytes
    private = json.loads(crypt_bytes((owner.inspection.HISTORY / "native-credentials.dpapi").read_bytes(), decrypt=True))
    result = {"priorManuallyStopped": True, "modelRequests": 0, "started": False, "stopped": False}
    try:
        assert owner.inspection.command(root, [str(owner.inspection.PG_CTL), "-D", str(root / "data"), "-l", str(root / "postgres-state.log"),
            "-o", f"-p {owner.PG_PORT} -h 127.0.0.1 -c shared_preload_libraries= -c lc_messages=C -c autovacuum=off", "-w", "-t", "30", "start"], "state-start") == 0
        result["started"] = True
        result["native"] = asyncio.run(read(private["pg_password"]))
    finally:
        result["stopped"] = owner.inspection.command(root, [str(owner.inspection.PG_CTL), "-D", str(root / "data"), "-m", "fast", "-w", "-t", "30", "stop"], "state-stop") == 0
        result["sourceUnchanged"] = bool(owner.source_verified())
        (root / "manual-stop-state.json").write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
        if result["stopped"]:
            previous = json.loads((root / "ownership.json").read_text(encoding="utf-8"))
            previous["stopped"] = True; previous["stopEvidence"] = "manual-stop-state.json"
            owner.inspection.write_json(root / "ownership.json", previous)
        print(json.dumps(result, default=str))
    assert result["stopped"]

if __name__ == "__main__": main()
