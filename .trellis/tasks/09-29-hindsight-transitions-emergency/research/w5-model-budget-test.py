"""Offline transport checks; no credentials, service startup or external HTTP."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("w5_budget", Path(__file__).with_name("w5-model-budget.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BudgetTest(unittest.IsolatedAsyncioTestCase):
    async def test_reviewed_continuation_keeps_cumulative_counter_and_new_finite_ceiling(self):
        with tempfile.TemporaryDirectory(prefix="taki-w5-budget-") as directory:
            root = Path(directory)
            (root / "model-submissions.json").write_text('{"submitted":209}', encoding="utf-8")
            request = SimpleNamespace(url=SimpleNamespace(host="api.deepseek.com"))
            calls = []

            async def send(client, actual_request):
                calls.append(actual_request)
                return SimpleNamespace(status_code=200)

            budget = module.ModelSubmissionBudget(root, {"modelRequests": 0}, cap=211)
            await budget.send(send, None, request)
            recovered = module.ModelSubmissionBudget(root, {"modelRequests": 0}, cap=211)
            await recovered.send(send, None, request)
            with self.assertRaisesRegex(RuntimeError, "BUDGET_EXHAUSTED"):
                await recovered.send(send, None, request)
            self.assertEqual(len(calls), 2)
            self.assertEqual(json.loads((root / "model-submissions.json").read_text())["submitted"], 211)
            with self.assertRaisesRegex(RuntimeError, "BUDGET_INVALID"):
                module.ModelSubmissionBudget(root, {}, cap=210)

    async def test_raising_ceiling_never_clears_existing_billing_latch(self):
        with tempfile.TemporaryDirectory(prefix="taki-w5-budget-") as directory:
            root = Path(directory)
            (root / "model-submissions.json").write_text('{"submitted":209}', encoding="utf-8")
            (root / "model-http402-latch.json").write_text('{"status":402,"submission":209}', encoding="utf-8")
            budget = module.ModelSubmissionBudget(root, {"modelRequests": 0}, cap=329)

            async def send(client, request):
                self.fail("A persisted account latch must prevent dispatch")

            request = SimpleNamespace(url=SimpleNamespace(host="api.deepseek.com"))
            with self.assertRaisesRegex(RuntimeError, "ACCOUNT_BLOCKED"):
                await budget.send(send, None, request)
            self.assertEqual(json.loads((root / "model-submissions.json").read_text())["submitted"], 209)

    async def test_first_402_passes_through_and_stops_later_submissions_across_restart(self):
        with tempfile.TemporaryDirectory(prefix="taki-w5-budget-") as directory:
            root = Path(directory)
            (root / "model-submissions.json").write_text('{"submitted":209}', encoding="utf-8")
            calls = []
            response = SimpleNamespace(status_code=402, private_body=object())
            request = SimpleNamespace(url=SimpleNamespace(host="api.deepseek.com"))

            async def send(client, actual_request):
                calls.append(actual_request)
                self.assertEqual(json.loads((root / "model-submissions.json").read_text())['submitted'], 210)
                return response

            budget = module.ModelSubmissionBudget(root, {"modelRequests": 0})
            self.assertIs(await budget.send(send, None, request), response)
            for instance in (budget, module.ModelSubmissionBudget(root, {"modelRequests": 0})):
                with self.assertRaisesRegex(RuntimeError, "ACCOUNT_BLOCKED"):
                    await instance.send(send, None, request)
            self.assertEqual(len(calls), 1)
            self.assertEqual(budget.state["submitted"], 210)

    async def test_last_allowed_submission_is_counted_and_next_one_is_refused(self):
        with tempfile.TemporaryDirectory(prefix="taki-w5-budget-") as directory:
            root = Path(directory)
            (root / "model-submissions.json").write_text('{"submitted":239}', encoding="utf-8")
            calls = []

            async def send(client, request):
                calls.append(request)
                return SimpleNamespace(status_code=200)

            budget = module.ModelSubmissionBudget(root, {"modelRequests": 0})
            request = SimpleNamespace(url=SimpleNamespace(host="api.deepseek.com"))
            await budget.send(send, None, request)
            with self.assertRaisesRegex(RuntimeError, "BUDGET_EXHAUSTED"):
                await budget.send(send, None, request)
            self.assertEqual(len(calls), 1)
            self.assertEqual(json.loads((root / "model-submissions.json").read_text())['submitted'], 240)


if __name__ == "__main__":
    unittest.main()
