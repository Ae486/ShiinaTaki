"""Task-only finite maintenance review gate. No production endpoint or proof substitute.

Preparation and the native service's incomplete/lease/recovery handling execute unchanged.
Only the exclusively owned engine's execution seam is wrapped. An approval is exact-plan,
per-Bank, finite, and cannot authorize a background request or another transition.
"""

from __future__ import annotations

import contextvars
import hashlib
import json
import math
import os
import uuid
from collections import Counter
from pathlib import Path


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + f".{uuid.uuid4().hex}.next")
    with temporary.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(value, output, indent=2, ensure_ascii=False)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


def read_checkpoint(path: Path) -> dict:
    envelope = json.loads(path.read_text(encoding="utf-8"))
    assert (
        envelope["version"] == 1
        and type(envelope["sequence"]) is int
        and envelope["sequence"] > 0
    )
    assert (
        hashlib.sha256(envelope["payloadJson"].encode()).hexdigest()
        == envelope["sha256"]
    )
    state = json.loads(envelope["payloadJson"])
    assert state["journey"]["version"] == 1
    return state


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


def summarize_requirements(candidate: dict, steps: list, batch_size: int) -> dict:
    """Counts refer to this exact candidate. Saved plans are reported separately, not assumed free."""
    assert type(batch_size) is int and batch_size > 0
    completed = {
        outcome["requirement_key"]
        for step in steps
        if step["state"] == "complete"
        for outcome in decoded(step["outcome_records"])
    }
    prepared = {
        key
        for step in steps
        if step["state"] == "prepared"
        for key in decoded(step["requirement_keys"])
    }
    requirements = candidate["requirements"]
    keys = {r["requirement_key"] for r in requirements}
    assert len(keys) == len(requirements) and completed <= keys and prepared <= keys
    records = {
        (row["object_kind"], row["object_id"]): row for row in candidate["records"]
    }
    groups = Counter()
    models = 0
    for requirement in requirements:
        if requirement["requirement_key"] in completed:
            continue
        if requirement["kind"] == "mental_model":
            models += 1
        else:
            assert requirement["kind"] == "source_scope"
            witness = requirement["input"]
            tags = records[(witness["object_kind"], witness["object_id"])]["payload"][
                "tags"
            ]
            groups[(tuple(sorted(tags)), tuple(requirement["scope_tags"]))] += 1
    batches = sum(math.ceil(count / batch_size) for count in groups.values())
    return {
        "totalRequirements": len(requirements),
        "completedRequirements": len(completed),
        "completedSteps": sum(step["state"] == "complete" for step in steps),
        "preparedSteps": sum(step["state"] == "prepared" for step in steps),
        "preparedReusablePlans": sum(
            step["state"] == "prepared"
            and isinstance(decoded(step["plan"]), dict)
            and decoded(step["plan"]).get("failed") is False
            for step in steps
        ),
        "preparedFailedPlans": sum(
            step["state"] == "prepared"
            and isinstance(decoded(step["plan"]), dict)
            and decoded(step["plan"]).get("failed") is True
            for step in steps
        ),
        "remainingSourceRequirements": sum(groups.values()),
        "remainingSourceBatches": batches,
        "remainingModels": models,
        "batchSize": batch_size,
        "baseCallEstimate": batches + models,
        "estimateIsUpperBound": False,
        "tokens": None,
        "cost": None,
    }


IDENTITY_FIELDS = (
    "bankId",
    "transitionId",
    "providerLineage",
    "bankGeneration",
    "candidateHash",
    "requiredSetHash",
    "policyHash",
    "requestHash",
    "deltaResultHash",
)


class ReentryGate:
    def __init__(
        self,
        root: Path,
        *,
        engine,
        supervisor_attempt: str,
        cumulative_cap: int,
        approval_path: Path | None = None,
    ):
        self.root, self.engine = root, engine
        self.supervisor_attempt, self.cap = supervisor_attempt, cumulative_cap
        self.approval = (
            json.loads(approval_path.read_text(encoding="utf-8"))
            if approval_path
            else None
        )
        self.active = contextvars.ContextVar("w5_reentry_plan", default=None)
        self.pauses = []
        self.usage_path = root / "reentry-bank-submissions.json"
        self.usage = (
            json.loads(self.usage_path.read_text(encoding="utf-8"))
            if self.usage_path.exists()
            else {"version": 1, "plans": {}}
        )
        assert self.usage["version"] == 1 and isinstance(self.usage["plans"], dict)
        for entry in self.usage["plans"].values():
            assert (
                type(entry["reservedSubmissions"]) is int
                and entry["reservedSubmissions"] >= 0
            )
        if self.approval is not None:
            assert (
                self.approval["version"] == 1
                and self.approval["cumulativeCap"] == self.cap
            )
            assert type(self.cap) is int and self.cap > 0
            banks = self.approval["banks"]
            assert len({entry["bankId"] for entry in banks}) == len(banks)
            for entry in banks:
                assert all(
                    isinstance(entry[key], str) and entry[key]
                    for key in IDENTITY_FIELDS
                )
                assert (
                    type(entry["maxSubmissions"]) is int
                    and 0 < entry["maxSubmissions"] <= self.cap
                )

    def bind(self, snapshot: dict) -> tuple[dict, dict]:
        state = read_checkpoint(self.root / "journey-checkpoint.json")
        anchor = state["journey"]["returnAnchor"]
        step = state["steps"]["reentry"]
        assert (
            snapshot["transitionId"] == step["transitionId"] != anchor["transitionId"]
        ), "W5_GATE_TRANSITION_MISMATCH"
        banks = [
            bank
            for bank in anchor["banks"]
            if bank["nativeBankId"] == snapshot["bankId"]
        ]
        assert (
            len(banks) == 1
            and banks[0]["nativeGeneration"] == snapshot["bankGeneration"]
        )
        assert anchor["providerLineage"] == snapshot["providerLineage"]
        assert snapshot["deltaResultHash"], "W5_GATE_DELTA_REQUIRED"
        snapshot.update(
            returnReceiptId=anchor["receiptId"],
            operationId=step["operationId"],
            supervisorAttempt=self.supervisor_attempt,
            cumulativeCap=self.cap,
        )
        return state, anchor

    def allowance(self, snapshot: dict, anchor: dict) -> dict | None:
        approval = self.approval
        if approval is None:
            return None
        assert approval["returnReceiptId"] == anchor["receiptId"]
        assert approval["transitionId"] == snapshot["transitionId"]
        matches = [
            entry
            for entry in approval["banks"]
            if entry["bankId"] == snapshot["bankId"]
        ]
        if not matches:
            return None
        entry = matches[0]
        assert all(entry[key] == snapshot[key] for key in IDENTITY_FIELDS), (
            "W5_GATE_APPROVAL_IDENTITY_MISMATCH"
        )
        return entry

    async def intercept(self, service, run, view, original):
        from hindsight_api.engine.cutover_verification import CutoverVerificationError
        from hindsight_api.engine.db_utils import acquire_with_retry

        assert service.engine is self.engine, "W5_GATE_FOREIGN_ENGINE"
        config = await service.policy(run.candidate.bank_id)
        assert config.enable_observations, "W5_OBSERVATIONS_DISABLED"
        async with acquire_with_retry(service.backend) as conn:
            steps = await conn.fetch(
                f"SELECT kind,state,requirement_keys,outcome_records,plan FROM {service.fq_table('memory_cutover_steps')} "
                "WHERE bank_id=$1 AND verification_id=$2",
                run.candidate.bank_id,
                run.request.verification_id,
            )
        snapshot = {
            "version": 1,
            "kind": "actual-post-delta-plan",
            "bankId": run.candidate.bank_id,
            "transitionId": str(run.request.verification_id),
            "providerLineage": str(run.request.provider_lineage),
            "bankGeneration": str(run.request.bank_generation),
            "candidateHash": run.candidate_hash,
            "requiredSetHash": run.required_set_hash,
            "policyHash": run.policy_hash,
            "requestHash": run.request.request_hash,
            "deltaResultHash": run.request.delta_result_hash,
            "attemptId": str(run.attempt_id),
            "maintenanceFence": str(run.maintenance_fence),
            "nativeStateAtCapture": run.state,
            **summarize_requirements(
                run.candidate.model_dump(mode="json"),
                steps,
                max(1, config.consolidation_llm_batch_size),
            ),
        }
        _, anchor = self.bind(snapshot)
        allowance = self.allowance(snapshot, anchor)
        snapshot["approved"] = allowance is not None
        counter = json.loads(
            (self.root / "model-submissions.json").read_text(encoding="utf-8")
        )
        snapshot["totalModelSubmissions"] = counter["submitted"]
        review_path = (
            self.root
            / f"reentry-plan-{self.supervisor_attempt}-{uuid.uuid4().hex}.json"
        )
        atomic_json(review_path, snapshot)
        if allowance is None:
            paused = {
                **snapshot,
                "reviewFile": review_path.name,
                "reason": "maintenance-review-required",
            }
            atomic_json(
                self.root / f"reentry-pause-{self.supervisor_attempt}.json", paused
            )
            self.pauses.append(paused)
            # The unchanged native catch records incomplete, stops heartbeat, and returns a normal refusal.
            raise CutoverVerificationError("operation_refused")
        token = self.active.set(allowance)
        try:
            return await original(service, run, view)
        finally:
            self.active.reset(token)

    async def send(self, delegate, budget, client, request, *args, **kwargs):
        if request.url.host != "api.deepseek.com":
            return await budget.send(delegate, client, request, *args, **kwargs)
        entry = self.active.get()
        if entry is None:
            raise RuntimeError("W5_REENTRY_UNAPPROVED_MODEL_REQUEST")
        if budget.latch.exists() or budget.state["submitted"] >= budget.cap:
            # Use the existing exact budget/latch refusal; do not reserve a Bank request that cannot dispatch.
            return await budget.send(delegate, client, request, *args, **kwargs)
        identity = {key: entry[key] for key in IDENTITY_FIELDS}
        key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        usage = self.usage["plans"].setdefault(
            key, {"identity": identity, "reservedSubmissions": 0}
        )
        assert usage["identity"] == identity
        if usage["reservedSubmissions"] >= entry["maxSubmissions"]:
            raise RuntimeError("W5_REENTRY_BANK_ALLOWANCE_EXHAUSTED")
        usage["reservedSubmissions"] += 1
        # Reserve before the existing global counter/network. A crash may conservatively consume an allowance,
        # never grant a free retry. This file is NOT a billing ledger; model-submissions.json remains cumulative.
        atomic_json(self.usage_path, self.usage)
        return await budget.send(delegate, client, request, *args, **kwargs)

    def install(self):
        from hindsight_api.engine.transition_maintenance import (
            TransitionMaintenanceService,
        )

        original = TransitionMaintenanceService._execute_attempt

        async def guarded(service, run, view):
            return await self.intercept(service, run, view, original)

        TransitionMaintenanceService._execute_attempt = guarded
        return lambda: setattr(
            TransitionMaintenanceService, "_execute_attempt", original
        )

    async def audit_pause(self, conn) -> dict:
        assert len(self.pauses) == 1, "W5_EXPECTED_EXACTLY_ONE_PAUSE"
        paused = self.pauses[0]
        row = await conn.fetchrow(
            "SELECT state,candidate_hash,required_set_hash,attempt_id,maintenance_fence FROM memory_transition_maintenance "
            "WHERE bank_id=$1 AND verification_id=$2",
            paused["bankId"],
            uuid.UUID(paused["transitionId"]),
        )
        assert row and row["state"] == "incomplete", "W5_PAUSE_NOT_DURABLY_INCOMPLETE"
        assert (
            row["candidate_hash"] == paused["candidateHash"]
            and row["required_set_hash"] == paused["requiredSetHash"]
        )
        assert (
            str(row["attempt_id"]) == paused["attemptId"]
            and str(row["maintenance_fence"]) == paused["maintenanceFence"]
        )
        state = read_checkpoint(self.root / "journey-checkpoint.json")
        assert (
            state["stagedPause"]["operationState"] == "outcome_unknown"
            and not state["completed"]
        )
        assert state["steps"]["reentry"]["operationId"] == paused["operationId"]
        assert state["steps"]["reentry"]["state"] == "outcome_unknown"
        submitted = json.loads(
            (self.root / "model-submissions.json").read_text(encoding="utf-8")
        )["submitted"]
        assert submitted == paused["totalModelSubmissions"], "W5_MODELS_AFTER_PAUSE"
        return {
            "outcome": "staged_pause",
            "operationState": "outcome_unknown",
            "nativeState": "incomplete",
            "bankId": paused["bankId"],
            "transitionId": paused["transitionId"],
            "reviewFile": paused["reviewFile"],
        }
