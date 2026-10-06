"""Task-owned transport guard: durable submission cap and first-HTTP402 latch.

This changes no native retry policy. The first provider response is returned unchanged;
later attempts are refused locally, including after process restart. Clearing the latch
requires the parent's explicit account-readiness instruction and is never automatic.
"""
from __future__ import annotations

import json
from pathlib import Path

CAP = 240


class ModelSubmissionBudget:
    def __init__(self, root: Path, summary: dict, *, cap: int = CAP):
        self.path = root / "model-submissions.json"
        self.latch = root / "model-http402-latch.json"
        self.summary = summary
        # A reviewed continuation changes the finite cumulative ceiling, never the stored attempt count.
        # The default preserves the original run's240 ceiling; each staged resume passes its own bound.
        if type(cap) is not int or cap <= 0:
            raise RuntimeError("W5_MODEL_REQUEST_BUDGET_INVALID")
        self.cap = cap
        self.state = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {"submitted": 0}
        count = self.state.get("submitted")
        if type(count) is not int or not 0 <= count <= self.cap:
            raise RuntimeError("W5_MODEL_REQUEST_BUDGET_INVALID")

    @staticmethod
    def write(path: Path, value: dict) -> None:
        # This single-process harness writes before the network await; replacing the owned temporary file
        # keeps a crash from leaving a partially encoded counter that could be mistaken for a fresh budget.
        temporary = path.with_suffix(path.suffix + ".next")
        temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)

    async def send(self, delegate, client, request, *args, **kwargs):
        if request.url.host != "api.deepseek.com":
            return await delegate(client, request, *args, **kwargs)
        if self.latch.exists():
            raise RuntimeError("W5_MODEL_ACCOUNT_BLOCKED_AFTER_HTTP402")
        if self.state["submitted"] >= self.cap:
            raise RuntimeError("W5_MODEL_REQUEST_BUDGET_EXHAUSTED")
        self.state["submitted"] += 1
        self.write(self.path, self.state)
        self.summary["modelRequests"] += 1
        self.summary["totalModelSubmissions"] = self.state["submitted"]
        response = await delegate(client, request, *args, **kwargs)
        if response.status_code == 402:
            self.write(self.latch, {"status": 402, "submission": self.state["submitted"], "cap": self.cap})
            self.summary["modelAccountBlocked"] = True
        return response
