"""Exact Bank/transition plan inspection; successor to the historical ordinal RETURN helper.

Starts only the existing owned PostgreSQL pair, read-only transaction, no engine/models.
Requires an explicit stable-Bank forecast and cumulative ceiling. Do not run alongside
the supervisor. Missing new plans remain forecasts, never an old RETURN completion.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import subprocess
import sys
import uuid
from pathlib import Path

from w5_reentry_gate import atomic_json, decoded, summarize_requirements

HERE = Path(__file__).resolve().parent


async def inspect_plans(
    conn, *, transition_id: uuid.UUID, forecasts: list[dict]
) -> list[dict]:
    assert forecasts and len({row["bankId"] for row in forecasts}) == len(forecasts)
    banks = await conn.fetch(
        "SELECT bank_id FROM replication_bank_state WHERE deleted_at IS NULL ORDER BY bank_id"
    )
    assert {row["bank_id"] for row in banks} == {row["bankId"] for row in forecasts}
    result = []
    for bank in banks:
        bank_id = bank["bank_id"]
        forecast = next(row for row in forecasts if row["bankId"] == bank_id)
        assert forecast["kind"] == "forecast-before-new-delta"
        plans = await conn.fetch(
            "SELECT * FROM memory_transition_maintenance WHERE bank_id=$1 AND verification_id=$2",
            bank_id,
            transition_id,
        )
        assert len(plans) <= 1, "W5_AMBIGUOUS_NATIVE_PLAN"
        if not plans:
            result.append(
                {
                    **forecast,
                    "transitionId": str(transition_id),
                    "actualPlanExists": False,
                    "estimateIsUpperBound": False,
                }
            )
            continue
        plan = plans[0]
        assert (
            str(plan["verification_id"]) == str(transition_id)
            and plan["bank_id"] == bank_id
        )
        candidate = decoded(plan["candidate"])
        assert str(candidate["bank_generation"]) == forecast["bankGeneration"]
        assert str(candidate["provider_lineage"]) == forecast["providerLineage"]
        steps = await conn.fetch(
            "SELECT kind,state,requirement_keys,outcome_records,plan FROM memory_transition_steps "
            "WHERE bank_id=$1 AND verification_id=$2",
            bank_id,
            transition_id,
        )
        result.append(
            {
                "kind": "actual-post-delta-plan",
                "bankId": bank_id,
                "transitionId": str(transition_id),
                "actualPlanExists": True,
                "state": plan["state"],
                "candidateHash": plan["candidate_hash"],
                "requiredSetHash": plan["required_set_hash"],
                "policyHash": plan["policy_hash"],
                "providerLineage": forecast["providerLineage"],
                "bankGeneration": forecast["bankGeneration"],
                **summarize_requirements(candidate, steps, forecast["batchSize"]),
            }
        )
    return result


def budget_remaining(root: Path, cap: int) -> dict:
    count = json.loads((root / "model-submissions.json").read_text(encoding="utf-8"))[
        "submitted"
    ]
    assert type(cap) is int and type(count) is int and cap >= count >= 301
    return {
        "cumulativeCap": cap,
        "totalModelSubmissions": count,
        "remainingSubmissions": cap - count,
        "billingLatchPresent": (root / "model-http402-latch.json").exists(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--transition-id", type=uuid.UUID, required=True)
    parser.add_argument("--submission-cap", type=int, required=True)
    parser.add_argument("--forecast", type=Path, required=True)
    args = parser.parse_args()
    forecasts = json.loads(args.forecast.read_text(encoding="utf-8"))["banks"]
    spec = importlib.util.spec_from_file_location(
        "w5_owner", HERE / "w5-reused-native.py"
    )
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    owner.source_verified()
    root = owner.ROOT
    assert not (root / "data/postmaster.pid").exists()
    status = subprocess.run(
        [str(owner.inspection.PG_CTL), "-D", str(root / "data"), "status"],
        capture_output=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
        check=False,
    )
    assert status.returncode == 3
    result = {
        "modelRequests": 0,
        "started": False,
        "stopped": False,
        **budget_remaining(root, args.submission_cap),
    }
    sys.path.insert(0, str(owner.VALIDATION))
    from real_hindsight_environment import crypt_bytes

    private = json.loads(
        crypt_bytes(
            (owner.inspection.HISTORY / "native-credentials.dpapi").read_bytes(),
            decrypt=True,
        )
    )

    async def inspect():
        import asyncpg

        conn = await asyncpg.connect(
            host="127.0.0.1",
            port=owner.PG_PORT,
            user="taki_real",
            password=private["pg_password"],
            database="taki_real",
        )
        try:
            await conn.execute("SET default_transaction_read_only=on")
            assert (
                Path(await conn.fetchval("SHOW data_directory")).resolve()
                == (root / "data").resolve()
            )
            async with conn.transaction(isolation="repeatable_read", readonly=True):
                return await inspect_plans(
                    conn, transition_id=args.transition_id, forecasts=forecasts
                )
        finally:
            await conn.close()

    output = root / f"reentry-plan-inspection-{uuid.uuid4().hex}.json"
    try:
        assert (
            owner.inspection.command(
                root,
                [
                    str(owner.inspection.PG_CTL),
                    "-D",
                    str(root / "data"),
                    "-l",
                    str(root / "postgres-forecast.log"),
                    "-o",
                    f"-p {owner.PG_PORT} -h 127.0.0.1 -c shared_preload_libraries= -c lc_messages=C -c autovacuum=off",
                    "-w",
                    "-t",
                    "30",
                    "start",
                ],
                "forecast-start",
            )
            == 0
        )
        result["started"] = True
        result["banks"] = asyncio.run(inspect())
    finally:
        if result["started"]:
            result["stopped"] = (
                owner.inspection.command(
                    root,
                    [
                        str(owner.inspection.PG_CTL),
                        "-D",
                        str(root / "data"),
                        "-m",
                        "fast",
                        "-w",
                        "-t",
                        "30",
                        "stop",
                    ],
                    "forecast-stop",
                )
                == 0
            )
        result["sourceUnchanged"] = bool(owner.source_verified())
        atomic_json(output, result)
        print(json.dumps({"file": str(output), **result}))
    assert result["stopped"]


if __name__ == "__main__":
    main()
