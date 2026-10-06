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
import sqlite3
import uuid
from collections import Counter
from contextlib import contextmanager
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
        type(envelope["version"]) is int
        and envelope["version"] == 1
        and type(envelope["sequence"]) is int
        and envelope["sequence"] > 0
    )
    assert (
        hashlib.sha256(envelope["payloadJson"].encode()).hexdigest()
        == envelope["sha256"]
    )
    state = json.loads(envelope["payloadJson"])
    assert isinstance(state, dict) and isinstance(state.get("steps"), dict)
    journey = state.get("journey")
    assert (
        isinstance(journey, dict)
        and type(journey.get("version")) is int
        and journey["version"] == 1
    )
    assert isinstance(journey.get("submissions"), list)
    return state


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


def identity_key(identity: dict) -> str:
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def usage_digest(value: dict) -> str:
    body = {key: item for key, item in value.items() if key != "sha256"}
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def audit_core_pause(root: Path, paused: dict) -> None:
    # Node has stopped before this audit. Its hashed checkpoint is an aid, not the Core outcome authority.
    db = sqlite3.connect(
        (root / "application.sqlite").resolve().as_uri() + "?mode=ro", uri=True
    )
    db.row_factory = sqlite3.Row
    try:
        operation = db.execute(
            "SELECT state,kind,producer_json,terminal_at FROM memory_operations WHERE operation_id=?",
            (paused["operationId"],),
        ).fetchone()
        assert (
            operation
            and operation["state"] == "outcome_unknown"
            and operation["terminal_at"]
        ), "W5_CORE_PAUSE_OUTCOME"
        assert operation["kind"] == "transition.reenter-hindsight", "W5_CORE_PAUSE_KIND"
        producer = json.loads(operation["producer_json"])
        assert (
            producer["kind"] == "transition"
            and producer["transitionId"] == paused["transitionId"]
        ), "W5_CORE_PAUSE_PRODUCER"
        row = db.execute(
            "SELECT attempt_json FROM memory_transition_attempts WHERE transition_id=?",
            (paused["transitionId"],),
        ).fetchone()
        attempt = json.loads(row[0]) if row else None
        assert (
            attempt
            and attempt["operationId"] == paused["operationId"]
            and attempt["phase"] != "terminal"
        ), "W5_CORE_PAUSE_OWNER"
        assert (
            db.execute(
                "SELECT 1 FROM memory_transition_receipts WHERE transition_id=?",
                (paused["transitionId"],),
            ).fetchone()
            is None
        ), "W5_CORE_PAUSE_ALREADY_COMMITTED"
    finally:
        db.close()


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
        if self.usage_path.exists():
            assert self.usage.get("sha256") == usage_digest(self.usage), (
                "W5_ALLOWANCE_HISTORY_HASH"
            )
        for key, entry in self.usage["plans"].items():
            identity = entry["identity"]
            assert set(identity) == set(IDENTITY_FIELDS)
            assert all(isinstance(value, str) and value for value in identity.values())
            assert key == identity_key(identity), "W5_ALLOWANCE_HISTORY_IDENTITY"
            assert (
                type(entry["reservedSubmissions"]) is int
                and entry["reservedSubmissions"] >= 0
            )
        count = json.loads(
            (root / "model-submissions.json").read_text(encoding="utf-8")
        )["submitted"]
        assert type(count) is int and 301 <= count <= self.cap, (
            "W5_REENTRY_COUNTER_REGRESSED"
        )
        # Reservations can exceed actual submissions after a crash, but can never cover fewer requests.
        reserved = sum(
            entry["reservedSubmissions"] for entry in self.usage["plans"].values()
        )
        assert reserved >= count - 301, "W5_ALLOWANCE_HISTORY_REGRESSED"
        if self.usage["plans"]:
            state = read_checkpoint(root / "journey-checkpoint.json")
            anchor = state["journey"]["returnAnchor"]
            transition_id = state["steps"]["reentry"]["transitionId"]
            seen_banks = set()
            for entry in self.usage["plans"].values():
                identity = entry["identity"]
                assert (
                    identity["transitionId"] == transition_id != anchor["transitionId"]
                ), "W5_ALLOWANCE_HISTORY_FOREIGN"
                banks = [
                    bank
                    for bank in anchor["banks"]
                    if bank["nativeBankId"] == identity["bankId"]
                ]
                assert len(banks) == 1 and identity["bankId"] not in seen_banks, (
                    "W5_ALLOWANCE_HISTORY_BANK"
                )
                assert (
                    banks[0]["nativeGeneration"] == identity["bankGeneration"]
                    and anchor["providerLineage"] == identity["providerLineage"]
                ), "W5_ALLOWANCE_HISTORY_NAMESPACE"
                seen_banks.add(identity["bankId"])
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
            "transitionRequestHash": run.request.transition_request_hash,
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
        with self.execution(allowance):
            return await original(service, run, view)

    @contextmanager
    def execution(self, allowance: dict):
        # ContextVar reset affects only this task. Children inherit the same permit object, so revoke that
        # object before resetting: a detached child may not keep spending after the owning execution returns.
        permit = {"entry": allowance, "live": True}
        token = self.active.set(permit)
        try:
            yield
        finally:
            permit["live"] = False
            self.active.reset(token)

    async def send(self, delegate, budget, client, request, *args, **kwargs):
        if request.url.host != "api.deepseek.com":
            # The reviewed model endpoint is exact. Raw IP/foreign-host HTTP must not bypass accounting
            # merely because the lower socket allowlist also contains the endpoint's resolved addresses.
            if request.url.host not in {"127.0.0.1", "localhost", "::1"}:
                raise RuntimeError("W5_REENTRY_FOREIGN_NETWORK_REQUEST")
            return await budget.send(delegate, client, request, *args, **kwargs)
        permit = self.active.get()
        if permit is None or not permit.get("live"):
            raise RuntimeError("W5_REENTRY_UNAPPROVED_MODEL_REQUEST")
        entry = permit["entry"]
        if budget.latch.exists() or budget.state["submitted"] >= budget.cap:
            # Use the existing exact budget/latch refusal; do not reserve a Bank request that cannot dispatch.
            return await budget.send(delegate, client, request, *args, **kwargs)
        identity = {key: entry[key] for key in IDENTITY_FIELDS}
        key = identity_key(identity)
        usage = self.usage["plans"].setdefault(
            key, {"identity": identity, "reservedSubmissions": 0}
        )
        assert usage["identity"] == identity
        if usage["reservedSubmissions"] >= entry["maxSubmissions"]:
            raise RuntimeError("W5_REENTRY_BANK_ALLOWANCE_EXHAUSTED")
        usage["reservedSubmissions"] += 1
        # Reserve before the existing global counter/network. A crash may conservatively consume an allowance,
        # never grant a free retry. This file is NOT a billing ledger; model-submissions.json remains cumulative.
        self.usage["sha256"] = usage_digest(self.usage)
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
            "SELECT state,candidate_hash,required_set_hash,policy_hash,request_hash,request,attempt_id,maintenance_fence FROM memory_transition_maintenance "
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
            row["policy_hash"] == paused["policyHash"]
            and row["request_hash"] == paused["requestHash"]
        ), "W5_PAUSE_NATIVE_PLAN"
        request = decoded(row["request"])
        assert (
            request["delta_result_hash"] == paused["deltaResultHash"]
            and request["transition_request_hash"] == paused["transitionRequestHash"]
        ), "W5_PAUSE_NATIVE_PLAN"
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
        audit_core_pause(self.root, paused)
        owner = await conn.fetchrow(
            "SELECT phase,attempt_id,fence_token,request_hash,provider_lineage,bank_generation FROM memory_transition_requests "
            "WHERE bank_id=$1 AND transition_id=$2",
            paused["bankId"],
            uuid.UUID(paused["transitionId"]),
        )
        assert owner and owner["phase"] == "fenced", "W5_PAUSE_NATIVE_PHASE"
        assert (
            str(owner["attempt_id"]) == paused["attemptId"]
            and str(owner["fence_token"]) == paused["maintenanceFence"]
        ), "W5_PAUSE_NATIVE_OWNER"
        assert owner["request_hash"] == paused["transitionRequestHash"], (
            "W5_PAUSE_NATIVE_REQUEST"
        )
        assert (
            str(owner["provider_lineage"]) == paused["providerLineage"]
            and str(owner["bank_generation"]) == paused["bankGeneration"]
        ), "W5_PAUSE_NATIVE_NAMESPACE"
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
