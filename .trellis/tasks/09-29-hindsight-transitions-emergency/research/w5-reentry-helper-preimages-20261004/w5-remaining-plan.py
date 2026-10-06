"""Read the original owned plan and count remaining work without any engine/model startup."""
from __future__ import annotations
import asyncio
import importlib.util
import json
import math
import subprocess
import sys
import uuid
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("w5_owner", HERE / "w5-reused-native.py")
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


async def inspect(password):
    import asyncpg
    conn = await asyncpg.connect(host="127.0.0.1", port=owner.PG_PORT, user="taki_real", password=password, database="taki_real")
    try:
        await conn.execute("SET default_transaction_read_only=on")
        assert Path(await conn.fetchval("SHOW data_directory")).resolve() == (owner.ROOT / "data").resolve()
        banks = await conn.fetch("SELECT bank_id FROM replication_bank_state WHERE deleted_at IS NULL ORDER BY bank_id")
        original = json.loads((owner.ROOT / "run-plan.json").read_text(encoding="utf-8"))["banks"]
        result = []
        for ordinal, bank in enumerate(banks):
            plan = await conn.fetchrow("SELECT * FROM memory_transition_maintenance WHERE bank_id=$1", bank["bank_id"])
            initial = original[ordinal]
            if not plan:
                result.append({"bankOrdinal": ordinal + 1, "planExists": False, "remainingSourceBatches": initial["sourceBatches"],
                               "remainingModels": initial["models"], "completedSteps": 0, "preparedSteps": 0})
                continue
            candidate = decoded(plan["candidate"])
            steps = await conn.fetch("SELECT kind,state,requirement_keys,outcome_records,plan FROM memory_transition_steps WHERE bank_id=$1 AND verification_id=$2",
                                     bank["bank_id"], plan["verification_id"])
            completed = {outcome["requirement_key"] for step in steps if step["state"] == "complete" for outcome in decoded(step["outcome_records"])}
            prepared = {key for step in steps if step["state"] == "prepared" for key in decoded(step["requirement_keys"])}
            records = {(row["object_kind"], row["object_id"]): row for row in candidate["records"]}
            groups = Counter()
            remaining_models = 0
            for requirement in candidate["requirements"]:
                if requirement["requirement_key"] in completed:
                    continue
                if requirement["kind"] == "mental_model":
                    remaining_models += 1
                elif requirement["kind"] == "source_scope":
                    witness = requirement["input"]
                    record = records[(witness["object_kind"], witness["object_id"])]
                    groups[(tuple(sorted(record["payload"]["tags"])), tuple(requirement["scope_tags"]))] += 1
            result.append({"bankOrdinal": ordinal + 1, "planExists": True, "state": plan["state"],
                           "candidateHash": plan["candidate_hash"], "requiredSetHash": plan["required_set_hash"],
                           "completedSteps": sum(step["state"] == "complete" for step in steps),
                           "preparedSteps": sum(step["state"] == "prepared" for step in steps),
                           "preparedStepsWithSavedPlan": sum(step["state"] == "prepared" and decoded(step["plan"]) is not None for step in steps),
                           "preparedReusablePlans": sum(step["state"] == "prepared" and isinstance(decoded(step["plan"]), dict)
                                                        and decoded(step["plan"]).get("failed") is False for step in steps),
                           "preparedFailedPlans": sum(step["state"] == "prepared" and isinstance(decoded(step["plan"]), dict)
                                                      and decoded(step["plan"]).get("failed") is True for step in steps),
                           "completedRequirements": len(completed), "preparedUncompletedRequirements": len(prepared - completed),
                           "unpreparedRequirements": len(candidate["requirements"]) - len(completed | prepared),
                           "remainingSourceRequirements": sum(groups.values()),
                           "remainingSourceBatches": sum(math.ceil(count / initial["batchSize"]) for count in groups.values()),
                           "remainingModels": remaining_models})
        return result
    finally:
        await conn.close()


def main():
    owner.source_verified()
    root = owner.ROOT
    assert not (root / "data/postmaster.pid").exists()
    status = subprocess.run([str(owner.inspection.PG_CTL), "-D", str(root / "data"), "status"], capture_output=True,
                            creationflags=subprocess.CREATE_NO_WINDOW, check=False)
    assert status.returncode == 3
    sys.path.insert(0, str(owner.VALIDATION))
    from real_hindsight_environment import crypt_bytes
    private = json.loads(crypt_bytes((owner.inspection.HISTORY / "native-credentials.dpapi").read_bytes(), decrypt=True))
    result = {"modelRequests": 0, "started": False, "stopped": False}
    output = root / f"remaining-plan-{uuid.uuid4().hex}.json"
    try:
        assert owner.inspection.command(root, [str(owner.inspection.PG_CTL), "-D", str(root / "data"), "-l", str(root / "postgres-forecast.log"),
            "-o", f"-p {owner.PG_PORT} -h 127.0.0.1 -c shared_preload_libraries= -c lc_messages=C -c autovacuum=off", "-w", "-t", "30", "start"], "forecast-start") == 0
        result["started"] = True
        result["banks"] = asyncio.run(inspect(private["pg_password"]))
        result["remainingSubmissions"] = 240 - json.loads((root / "model-submissions.json").read_text())["submitted"]
    finally:
        if result["started"]:
            result["stopped"] = owner.inspection.command(root, [str(owner.inspection.PG_CTL), "-D", str(root / "data"), "-m", "fast", "-w", "-t", "30", "stop"], "forecast-stop") == 0
        result["sourceUnchanged"] = bool(owner.source_verified())
        output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"file": str(output), **result}))
    assert result["stopped"]


if __name__ == "__main__":
    main()
