"""Independent task-gate lifetime/accounting regressions; temporary files and synthetic transport only."""

import asyncio
import importlib.util
import json
import sqlite3
import tempfile
import unittest
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from w5_reentry_gate import (
    IDENTITY_FIELDS,
    ReentryGate,
    atomic_json,
    identity_key,
    read_checkpoint,
    usage_digest,
)

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "helper_test_support", HERE / "w5-reentry-gate-test.py"
)
support = importlib.util.module_from_spec(spec)
spec.loader.exec_module(support)


class IndependentGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_pause_checkpoint_cannot_hide_a_different_actual_core_outcome(self):
        with tempfile.TemporaryDirectory(prefix="w5-check-pause-") as folder:
            root = Path(folder)
            state, run = support.fixture(root)
            state["stagedPause"] = {"operationState": "outcome_unknown"}
            state["steps"]["reentry"]["state"] = "outcome_unknown"
            support.save_checkpoint(root, state)
            gate = ReentryGate(
                root, engine=object(), supervisor_attempt="7" * 32, cumulative_cap=305
            )
            paused = {
                "bankId": "bank-a",
                "transitionId": str(run.request.verification_id),
                "candidateHash": run.candidate_hash,
                "requiredSetHash": run.required_set_hash,
                "policyHash": run.policy_hash,
                "requestHash": run.request.request_hash,
                "deltaResultHash": run.request.delta_result_hash,
                "transitionRequestHash": run.request.transition_request_hash,
                "attemptId": str(run.attempt_id),
                "maintenanceFence": str(run.maintenance_fence),
                "operationId": "synthetic-operation",
                "totalModelSubmissions": 301,
                "reviewFile": "synthetic-review.json",
            }
            gate.pauses.append(paused)
            db = sqlite3.connect(root / "application.sqlite")
            db.execute(
                "CREATE TABLE memory_operations(operation_id TEXT, state TEXT, kind TEXT, producer_json TEXT, terminal_at TEXT)"
            )
            db.execute(
                "INSERT INTO memory_operations VALUES(?,?,?,?,?)",
                (
                    "synthetic-operation",
                    "completed",
                    "transition.reenter-hindsight",
                    json.dumps(
                        {"kind": "transition", "transitionId": paused["transitionId"]}
                    ),
                    "2026-10-04",
                ),
            )
            db.commit()
            db.close()
            with self.assertRaisesRegex(AssertionError, "CORE_PAUSE"):
                await gate.audit_pause(support.SyntheticConnection(run))

    async def test_inherited_child_context_cannot_dispatch_after_success_error_or_cancellation(
        self,
    ):
        for ending in ("success", "error", "cancel"):
            with self.subTest(ending=ending):
                await self.check_execution_lifetime(ending)

    async def check_execution_lifetime(self, ending):
        with tempfile.TemporaryDirectory(prefix="w5-check-lifetime-") as folder:
            root = Path(folder)
            _, run = support.fixture(root)
            engine = object()
            gate = ReentryGate(
                root, engine=engine, supervisor_attempt="8" * 32, cumulative_cap=305
            )
            snapshot = {
                "bankId": "bank-a",
                "transitionId": str(run.request.verification_id),
                "providerLineage": str(run.request.provider_lineage),
                "bankGeneration": str(run.request.bank_generation),
                "candidateHash": run.candidate_hash,
                "requiredSetHash": run.required_set_hash,
                "policyHash": run.policy_hash,
                "requestHash": run.request.request_hash,
                "transitionRequestHash": run.request.transition_request_hash,
                "deltaResultHash": run.request.delta_result_hash,
            }
            gate.bind(snapshot)
            gate.approval = support.approval_for(snapshot)
            service = SimpleNamespace(
                engine=engine,
                backend=object(),
                fq_table=lambda name: name,
                policy=AsyncMock(
                    return_value=SimpleNamespace(
                        enable_observations=True, consolidation_llm_batch_size=8
                    )
                ),
            )
            conn = support.SyntheticConnection(run)

            @asynccontextmanager
            async def acquire(*args, **kwargs):
                yield conn

            budget = support.budget_module.ModelSubmissionBudget(
                root, {"modelRequests": 0}, cap=305
            )
            delegate = AsyncMock(return_value=SimpleNamespace(status_code=200))
            request = SimpleNamespace(url=SimpleNamespace(host="api.deepseek.com"))
            released = asyncio.Event()
            children = []

            async def original(*args):
                async def detached():
                    await released.wait()
                    return await gate.send(delegate, budget, None, request)

                children.append(asyncio.create_task(detached()))
                if ending == "error":
                    raise RuntimeError("synthetic-owned-error")
                if ending == "cancel":
                    raise asyncio.CancelledError()

            with patch("hindsight_api.engine.db_utils.acquire_with_retry", acquire):
                if ending == "success":
                    await gate.intercept(service, run, None, original)
                else:
                    error = (
                        RuntimeError if ending == "error" else asyncio.CancelledError
                    )
                    with self.assertRaises(error):
                        await gate.intercept(service, run, None, original)
            released.set()
            with self.assertRaisesRegex(RuntimeError, "UNAPPROVED_MODEL_REQUEST"):
                await children[0]
            delegate.assert_not_awaited()
            self.assertEqual(budget.state["submitted"], 301)
            # Revocation is scoped to the old execution. A fresh reviewed owner still has its own permit.
            with gate.execution(gate.approval["banks"][0]):
                await gate.send(delegate, budget, None, request)
            self.assertEqual(budget.state["submitted"], 302)
            delegate.assert_awaited_once()

    async def test_existing_but_empty_bank_history_cannot_reset_consumed_allowance(
        self,
    ):
        with tempfile.TemporaryDirectory(prefix="w5-check-accounting-") as folder:
            root = Path(folder)
            support.fixture(root)
            atomic_json(root / "model-submissions.json", {"submitted": 302})
            history = {"version": 1, "plans": {}}
            history["sha256"] = usage_digest(history)
            atomic_json(root / "reentry-bank-submissions.json", history)
            with self.assertRaises((AssertionError, RuntimeError)):
                ReentryGate(
                    root,
                    engine=object(),
                    supervisor_attempt="9" * 32,
                    cumulative_cap=305,
                )

    async def test_history_identity_integrity_and_conservative_reservations(self):
        for fault in (
            "missing",
            "regressed",
            "foreign-transition",
            "foreign-bank",
            "foreign-namespace",
            "wrong-key",
            "hash",
            "conservative",
        ):
            with (
                self.subTest(fault=fault),
                tempfile.TemporaryDirectory(prefix="w5-history-") as folder,
            ):
                root = Path(folder)
                _, run = support.fixture(root)
                identity = {
                    "bankId": "bank-a",
                    "transitionId": str(run.request.verification_id),
                    "providerLineage": str(run.request.provider_lineage),
                    "bankGeneration": str(run.request.bank_generation),
                    "candidateHash": run.candidate_hash,
                    "requiredSetHash": run.required_set_hash,
                    "policyHash": run.policy_hash,
                    "requestHash": run.request.request_hash,
                    "deltaResultHash": run.request.delta_result_hash,
                }
                self.assertEqual(set(identity), set(IDENTITY_FIELDS))
                atomic_json(root / "model-submissions.json", {"submitted": 302})
                if fault == "foreign-transition":
                    identity["transitionId"] = str(uuid.uuid4())
                if fault == "foreign-bank":
                    identity["bankId"] = "bank-foreign"
                if fault == "foreign-namespace":
                    identity["bankGeneration"] = str(uuid.uuid4())
                key = "wrong" if fault == "wrong-key" else identity_key(identity)
                history = {
                    "version": 1,
                    "plans": {
                        key: {
                            "identity": identity,
                            "reservedSubmissions": 0 if fault == "regressed" else 3,
                        }
                    },
                }
                history["sha256"] = usage_digest(history)
                if fault == "hash":
                    history["plans"][key]["reservedSubmissions"] = 4
                if fault != "missing":
                    atomic_json(root / "reentry-bank-submissions.json", history)
                if fault == "conservative":
                    loaded = ReentryGate(
                        root,
                        engine=object(),
                        supervisor_attempt="6" * 32,
                        cumulative_cap=305,
                    )
                    self.assertEqual(
                        loaded.usage["plans"][key]["reservedSubmissions"], 3
                    )
                else:
                    with self.assertRaises(AssertionError):
                        ReentryGate(
                            root,
                            engine=object(),
                            supervisor_attempt="6" * 32,
                            cumulative_cap=305,
                        )

    async def test_foreign_or_raw_ip_http_cannot_bypass_model_accounting(self):
        with tempfile.TemporaryDirectory(prefix="w5-foreign-") as folder:
            root = Path(folder)
            support.fixture(root)
            gate = ReentryGate(
                root, engine=object(), supervisor_attempt="5" * 32, cumulative_cap=305
            )
            budget = support.budget_module.ModelSubmissionBudget(
                root, {"modelRequests": 0}, cap=305
            )
            delegate = AsyncMock()
            for host in ("foreign.invalid", "203.0.113.1"):
                with self.assertRaisesRegex(RuntimeError, "FOREIGN_NETWORK_REQUEST"):
                    await gate.send(
                        delegate,
                        budget,
                        None,
                        SimpleNamespace(url=SimpleNamespace(host=host)),
                    )
            delegate.assert_not_awaited()
            self.assertEqual(budget.state["submitted"], 301)

    async def test_supervisor_rejects_hash_valid_unsupported_checkpoint_shape(self):
        with tempfile.TemporaryDirectory(prefix="w5-shape-") as folder:
            root = Path(folder)
            state, _ = support.fixture(root)
            del state["journey"]["submissions"]
            support.save_checkpoint(root, state)
            with self.assertRaises(AssertionError):
                read_checkpoint(root / "journey-checkpoint.json")


if __name__ == "__main__":
    unittest.main(verbosity=2)
