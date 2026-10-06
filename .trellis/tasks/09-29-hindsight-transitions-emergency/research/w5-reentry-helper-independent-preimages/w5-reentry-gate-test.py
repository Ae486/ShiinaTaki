"""Zero-model gate regressions over real native prepare/verify control flow and synthetic storage."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from w5_reentry_gate import IDENTITY_FIELDS, ReentryGate, atomic_json, read_checkpoint

HERE = Path(__file__).resolve().parent
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
sys.path.insert(0, "H:/hindsight/hindsight-api-slim")


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


budget_module = load("w5_budget_test_subject", "w5-model-budget.py")
plan_module = load("w5_plan_test_subject", "w5-reentry-plan.py")


def save_checkpoint(root, state):
    import hashlib

    payload = json.dumps(state, ensure_ascii=False)
    atomic_json(
        root / "journey-checkpoint.json",
        {
            "version": 1,
            "sequence": 1,
            "payloadJson": payload,
            "sha256": hashlib.sha256(payload.encode()).hexdigest(),
        },
    )


def fixture(root):
    transition_id = uuid.uuid4()
    lineage = uuid.uuid4()
    generation = uuid.uuid4()
    state = {
        "completed": False,
        "steps": {
            "reentry": {
                "transitionId": str(transition_id),
                "operationId": "synthetic-operation",
            }
        },
        "journey": {
            "version": 1,
            "returnAnchor": {
                "transitionId": str(uuid.uuid4()),
                "receiptId": "e" * 64,
                "providerLineage": str(lineage),
                "banks": [
                    {"nativeBankId": "bank-a", "nativeGeneration": str(generation)},
                    {"nativeBankId": "bank-b", "nativeGeneration": str(generation)},
                ],
            },
        },
    }
    save_checkpoint(root, state)
    atomic_json(root / "model-submissions.json", {"submitted": 301})
    candidate_json = {
        "bank_id": "bank-a",
        "bank_generation": str(generation),
        "provider_lineage": str(lineage),
        "records": [
            {
                "object_kind": "memory_unit",
                "object_id": "unit",
                "payload": {"tags": ["private-synthetic-tag"]},
            }
        ],
        "requirements": [
            {
                "requirement_key": "a" * 64,
                "kind": "source_scope",
                "scope_tags": [],
                "input": {"object_kind": "memory_unit", "object_id": "unit"},
            }
        ],
    }
    candidate = SimpleNamespace(
        bank_id="bank-a",
        cursor=0,
        records=[],
        history=[],
        model_tracking={},
        model_dump=lambda **kwargs: candidate_json,
    )
    run = SimpleNamespace(
        candidate=candidate,
        state="incomplete",
        candidate_hash="a" * 64,
        required_set_hash="b" * 64,
        policy_hash="c" * 64,
        attempt_id=uuid.uuid4(),
        maintenance_fence=uuid.uuid4(),
        request=SimpleNamespace(
            verification_id=transition_id,
            provider_lineage=lineage,
            bank_generation=generation,
            request_hash="d" * 64,
            delta_result_hash="f" * 64,
        ),
    )
    return state, run


def approval_for(snapshot, cap=305, maximum=2):
    return {
        "version": 1,
        "transitionId": snapshot["transitionId"],
        "returnReceiptId": snapshot["returnReceiptId"],
        "cumulativeCap": cap,
        "banks": [
            {
                **{key: snapshot[key] for key in IDENTITY_FIELDS},
                "maxSubmissions": maximum,
            }
        ],
    }


class SyntheticConnection:
    """Only native storage IO is substituted; prepare, catch/incomplete and proof fast path are real."""

    def __init__(self, run):
        self.run = run
        self.steps = []
        self.statements = []

    @asynccontextmanager
    async def transaction(self, **kwargs):
        yield self

    async def execute(self, sql, *args):
        self.statements.append(sql)
        if "SET state='running'" in sql:
            self.run.state = "running"
            self.run.attempt_id, self.run.maintenance_fence = args[2:4]
        elif "SET state='incomplete'" in sql:
            self.run.state = "incomplete"
        else:
            raise AssertionError(sql)

    async def fetch(self, sql, *args):
        assert "WHERE bank_id=$1 AND verification_id=$2" in sql
        assert args == (self.run.candidate.bank_id, self.run.request.verification_id)
        return self.steps

    async def fetchrow(self, sql, *args):
        assert "WHERE bank_id=$1 AND verification_id=$2" in sql
        assert args == (self.run.candidate.bank_id, self.run.request.verification_id)
        return {
            "state": self.run.state,
            "candidate_hash": self.run.candidate_hash,
            "required_set_hash": self.run.required_set_hash,
            "attempt_id": self.run.attempt_id,
            "maintenance_fence": self.run.maintenance_fence,
        }


class GateTests(unittest.IsolatedAsyncioTestCase):
    async def test_supervisor_installs_gate_before_initialize_and_default_preview_disables_model_network(
        self,
    ):
        import httpx
        from hindsight_api.engine import memory_engine, transition_maintenance

        owner = load("w5_supervisor_startup_subject", "w5-reused-native.py")
        with tempfile.TemporaryDirectory(prefix="w5-startup-") as folder:
            root = Path(folder)
            fixture(root)
            seen = []
            original_send = httpx.AsyncClient.send
            original_execute = (
                transition_maintenance.TransitionMaintenanceService._execute_attempt
            )
            test = self

            class Engine:
                def __init__(self, **kwargs):
                    pass

                async def initialize(self):
                    test.assertIsNot(httpx.AsyncClient.send, original_send)
                    test.assertIsNot(
                        transition_maintenance.TransitionMaintenanceService._execute_attempt,
                        original_execute,
                    )
                    request = SimpleNamespace(
                        url=SimpleNamespace(host="api.deepseek.com")
                    )
                    with test.assertRaisesRegex(
                        RuntimeError, "UNAPPROVED_MODEL_REQUEST"
                    ):
                        await httpx.AsyncClient.send(None, request)
                    seen.append("initialize-guarded")
                    raise RuntimeError("SYNTHETIC_STOP_AFTER_STARTUP_GUARD")

                async def close(self):
                    seen.append("closed")

            async def finish(**kwargs):
                test.assertEqual(
                    str(kwargs["primary_error"]), "SYNTHETIC_STOP_AFTER_STARTUP_GUARD"
                )
                await kwargs["engine"].close()

            network = SimpleNamespace(
                install_guard=lambda *args, **kwargs: seen.append(
                    kwargs["model_access"]
                ),
                observation_status=lambda: {},
                observe_model_calls=lambda root: None,
            )
            listener = SimpleNamespace(
                bind=lambda *args: None, listen=lambda *args: None
            )
            summary = {"attemptId": "4" * 32, "modelRequests": 0}
            with (
                patch.object(owner, "ROOT", root),
                patch.object(owner.socket, "socket", return_value=listener),
                patch.object(memory_engine, "MemoryEngine", Engine),
                patch.dict(sys.modules, {"real_hindsight_network": network}),
                patch.object(owner.shutdown, "finish_execution", finish),
            ):
                with self.assertRaisesRegex(
                    RuntimeError, "SYNTHETIC_STOP_AFTER_STARTUP_GUARD"
                ):
                    await owner.execute(
                        "synthetic-password",
                        "run",
                        summary,
                        stage="reentry",
                        submission_cap=305,
                    )
            self.assertEqual(seen, [False, "initialize-guarded", "closed"])
            self.assertEqual(summary["modelRequests"], 0)
            self.assertEqual(
                json.loads((root / "model-submissions.json").read_text())["submitted"],
                301,
            )
            self.assertIs(httpx.AsyncClient.send, original_send)
            self.assertIs(
                transition_maintenance.TransitionMaintenanceService._execute_attempt,
                original_execute,
            )

    async def test_actual_prepare_then_denial_incomplete_same_transition_resume_and_completed_bank_reuse(
        self,
    ):
        from hindsight_api.engine import transition_maintenance as native
        from hindsight_api.engine.cutover_verification import CutoverVerificationError
        from hindsight_api.engine.transition_models import TakiTransitionExecutor

        with tempfile.TemporaryDirectory(prefix="w5-gate-") as folder:
            root = Path(folder)
            state, run = fixture(root)
            conn = SyntheticConnection(run)
            engine = object()
            service = object.__new__(native.TransitionMaintenanceService)
            service.engine, service.backend, service.fq_table = (
                engine,
                object(),
                lambda table: table,
            )
            status = SimpleNamespace(proof=None, executor=None)
            service.owner = SimpleNamespace(
                lookup=AsyncMock(side_effect=lambda *args: status),
                fence=AsyncMock(),
                _read=AsyncMock(return_value={"phase": "fenced"}),
                renew=AsyncMock(),
            )
            service.policy = AsyncMock(
                return_value=SimpleNamespace(
                    enable_observations=True, consolidation_llm_batch_size=8
                )
            )
            executor = TakiTransitionExecutor(
                transition_id=run.request.verification_id,
                attempt_id=uuid.uuid4(),
                fence_token=uuid.uuid4(),
                generation=2,
            )

            @asynccontextmanager
            async def acquire(*args, **kwargs):
                yield conn

            with (
                patch.object(native, "acquire_with_retry", acquire),
                patch("hindsight_api.engine.db_utils.acquire_with_retry", acquire),
                patch.object(native, "lock_transition_bank", AsyncMock()),
                patch.object(native, "assert_transition_executor", AsyncMock()),
                patch.object(native, "assert_no_accepted_work", AsyncMock()),
                patch.object(
                    native,
                    "read_transition_maintenance",
                    AsyncMock(side_effect=lambda *args: run),
                ),
            ):
                gate = ReentryGate(
                    root, engine=engine, supervisor_attempt="1" * 32, cumulative_cap=305
                )
                executed = AsyncMock()

                async def denied(run_value, view):
                    return await gate.intercept(service, run_value, view, executed)

                service._execute_attempt = denied
                with self.assertRaises(CutoverVerificationError):
                    await service.verify_transition("bank-a", executor)
                self.assertEqual(run.state, "incomplete")
                self.assertEqual(run.attempt_id, executor.attempt_id)
                self.assertIn("SET state='running'", conn.statements[0])
                executed.assert_not_awaited()
                self.assertEqual(
                    json.loads((root / "model-submissions.json").read_text())[
                        "submitted"
                    ],
                    301,
                )
                paused = gate.pauses[0]
                self.assertEqual(paused["baseCallEstimate"], 1)
                self.assertEqual(paused["nativeStateAtCapture"], "running")
                state["steps"]["reentry"]["state"] = "outcome_unknown"
                state["stagedPause"] = {"operationState": "outcome_unknown"}
                save_checkpoint(root, state)
                audited = await gate.audit_pause(conn)
                self.assertEqual(audited["outcome"], "staged_pause")
                self.assertEqual(audited["nativeState"], "incomplete")
                atomic_json(root / "model-submissions.json", {"submitted": 302})
                with self.assertRaisesRegex(AssertionError, "MODELS_AFTER_PAUSE"):
                    await gate.audit_pause(conn)
                atomic_json(root / "model-submissions.json", {"submitted": 301})
                self.assertNotIn(
                    "private-synthetic-tag", json.dumps(paused)
                )  # No prompt/tags or memory body in public snapshot.
                approval_path = root / "approval.json"
                atomic_json(approval_path, approval_for(paused))
                resumed = ReentryGate(
                    root,
                    engine=engine,
                    supervisor_attempt="2" * 32,
                    cumulative_cap=305,
                    approval_path=approval_path,
                )
                actions = []

                async def complete(service_value, run_value, view):
                    actions.append("bank-a-once")
                    run_value.state = "complete"
                    status.proof = "synthetic-only-proof"
                    status.executor = executor

                async def allowed(run_value, view):
                    return await resumed.intercept(service, run_value, view, complete)

                service._execute_attempt = allowed
                await service.verify_transition("bank-a", executor)
                self.assertEqual(run.state, "complete")
                # The unchanged real verify proof path returns without preparation or gate/execution again.
                await service.verify_transition("bank-a", executor)
                self.assertEqual(actions, ["bank-a-once"])
                self.assertEqual(conn.statements.count(conn.statements[0]), 2)
                # Bank B has the same new transition but no approval. A's allowance cannot authorize B.
                status.proof = None
                run.candidate.bank_id = "bank-b"
                run.state = "incomplete"
                with self.assertRaises(CutoverVerificationError):
                    await service.verify_transition("bank-b", executor)
                self.assertEqual(resumed.pauses[0]["bankId"], "bank-b")
                self.assertEqual(actions, ["bank-a-once"])
                self.assertEqual(run.state, "incomplete")

    async def test_per_bank_cap_counter_and_first_402_latch_survive_restart(self):
        with tempfile.TemporaryDirectory(prefix="w5-budget-") as folder:
            root = Path(folder)
            _, run = fixture(root)
            gate = ReentryGate(
                root, engine=object(), supervisor_attempt="1" * 32, cumulative_cap=305
            )
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
                "maxSubmissions": 1,
            }
            budget = budget_module.ModelSubmissionBudget(
                root, {"modelRequests": 0}, cap=305
            )
            response = SimpleNamespace(status_code=200)
            delegate = AsyncMock(return_value=response)
            request = SimpleNamespace(url=SimpleNamespace(host="api.deepseek.com"))
            with self.assertRaisesRegex(RuntimeError, "UNAPPROVED"):
                await gate.send(delegate, budget, None, request)
            self.assertEqual(budget.state["submitted"], 301)
            gate.active.set(identity)
            self.assertIs(await gate.send(delegate, budget, None, request), response)
            self.assertEqual(budget.state["submitted"], 302)
            gate = ReentryGate(
                root, engine=object(), supervisor_attempt="2" * 32, cumulative_cap=305
            )
            gate.active.set(identity)
            with self.assertRaisesRegex(RuntimeError, "ALLOWANCE_EXHAUSTED"):
                await gate.send(delegate, budget, None, request)
            self.assertEqual(delegate.await_count, 1)
            identity = {**identity, "maxSubmissions": 3}
            gate.active.set(identity)
            blocked = SimpleNamespace(status_code=402)
            delegate.return_value = blocked
            self.assertIs(await gate.send(delegate, budget, None, request), blocked)
            self.assertEqual(budget.state["submitted"], 303)
            latch_before = (root / "model-http402-latch.json").read_bytes()
            gate = ReentryGate(
                root, engine=object(), supervisor_attempt="3" * 32, cumulative_cap=305
            )
            gate.active.set(identity)
            budget = budget_module.ModelSubmissionBudget(
                root, {"modelRequests": 0}, cap=305
            )
            with self.assertRaisesRegex(RuntimeError, "ACCOUNT_BLOCKED"):
                await gate.send(delegate, budget, None, request)
            self.assertEqual(delegate.await_count, 2)
            self.assertEqual(budget.state["submitted"], 303)
            self.assertEqual(
                (root / "model-http402-latch.json").read_bytes(), latch_before
            )

    async def test_exact_transition_selection_never_reads_old_complete_return_or_bank_ordinal(
        self,
    ):
        transition = uuid.uuid4()
        old = uuid.uuid4()
        forecasts = [
            {
                "kind": "forecast-before-new-delta",
                "bankId": bank,
                "providerLineage": "lineage",
                "bankGeneration": "generation",
                "batchSize": 8,
                "sourceBatches": 2,
                "models": 1,
            }
            for bank in ("bank-b", "bank-a")
        ]
        candidate = {
            "provider_lineage": "lineage",
            "bank_generation": "generation",
            "records": [],
            "requirements": [],
        }
        old_plan = {
            "bank_id": "bank-a",
            "verification_id": old,
            "state": "complete",
            "candidate": candidate,
        }
        new_plan = {
            **old_plan,
            "verification_id": transition,
            "state": "incomplete",
            "candidate_hash": "new",
            "required_set_hash": "new-required",
            "policy_hash": "policy",
        }

        async def fetch(sql, *args):
            if "replication_bank_state" in sql:
                return [{"bank_id": "bank-a"}, {"bank_id": "bank-b"}]
            if "memory_transition_steps" in sql:
                return []
            self.assertIn("AND verification_id=$2", sql)
            return [
                plan
                for plan in (old_plan, new_plan)
                if (plan["bank_id"], plan["verification_id"]) == args
            ]

        result = await plan_module.inspect_plans(
            SimpleNamespace(fetch=fetch), transition_id=transition, forecasts=forecasts
        )
        self.assertEqual(result[0]["candidateHash"], "new")
        self.assertEqual(result[1]["bankId"], "bank-b")
        self.assertFalse(result[1]["actualPlanExists"])
        self.assertEqual(result[1]["kind"], "forecast-before-new-delta")

    async def test_malformed_checkpoint_and_wrong_candidate_approval_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="w5-invalid-") as folder:
            root = Path(folder)
            _, run = fixture(root)
            gate = ReentryGate(
                root, engine=object(), supervisor_attempt="1" * 32, cumulative_cap=305
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
                "deltaResultHash": run.request.delta_result_hash,
            }
            _, anchor = gate.bind(snapshot)
            gate.approval = approval_for(snapshot)
            gate.approval["banks"][0]["candidateHash"] = "wrong"
            with self.assertRaisesRegex(AssertionError, "IDENTITY_MISMATCH"):
                gate.allowance(snapshot, anchor)
            (root / "journey-checkpoint.json").write_text("{", encoding="utf-8")
            with self.assertRaises(json.JSONDecodeError):
                read_checkpoint(root / "journey-checkpoint.json")


if __name__ == "__main__":
    unittest.main(verbosity=2)
