import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { awaitApprovalRequest, respondApproval, triggerCapability } from "./fixture/operator-drivers.ts";
import { withStack } from "./fixture/with-stack.ts";

/**
 * Process-level Slice 3B proof: the real Core and taki-node exchange a preflight request, Core persists the
 * target Effect intent, and only then does the relay release the explicit execute frame to the Host.
 */
describe("real Core/Host Effect lifecycle", () => {
  it("persists intent before capability.execute and settles exactly once after release", async () => {
    await withStack({ devTrigger: true, nodeWsRelay: true, autoApprove: "allow-once" }, async (stack) => {
      await stack.setPermissionLevel("relaxed");
      const relay = stack.relay();
      if (!relay) throw new Error("relay was not configured");
      const paused = relay.pauseNextExecute();
      const drive = triggerCapability(await stack.operator(), { capability: "process_list", input: {}, timeoutMs: 60_000, lifecycle: true });
      const frame = await Promise.race([
        paused,
        drive.then((result) => { throw new Error(`drive settled before capability.execute: ${JSON.stringify(result)}`); }),
      ]);
      expect(frame.execute.control.runId).toMatch(/[0-9a-f-]{36}/);
      expect(frame.execute.control.coreAttemptId).toMatch(/[0-9a-f-]{36}/);
      expect(frame.execute.control.effectId).toMatch(/[0-9a-f-]{36}/);
      const effectId = frame.execute.control.effectId;
      const coreAttemptId = frame.execute.control.coreAttemptId;
      if (!effectId || !coreAttemptId) throw new Error("Host execute frame lost Core lifecycle identity");
      expect(relay.requestCount()).toBeGreaterThanOrEqual(1);

      const db = new DatabaseSync(`${stack.coreDataDir}/taki.db`, { readOnly: true });
      try {
        const intent = db.prepare("SELECT run_id, attempt_id, effect_id, state, outcome FROM run_effects WHERE effect_id = ?").get(effectId) as Record<string, unknown> | undefined;
        expect(intent).toMatchObject({
          run_id: frame.execute.control.runId,
          attempt_id: coreAttemptId,
          effect_id: effectId,
          state: "intent_committed",
          outcome: null,
        });
      } finally {
        db.close();
      }

      frame.release();
      const result = await drive as { runId: string; attemptId: string; result: { ok: boolean } };
      expect(result.runId).toBe(frame.execute.control.runId);
      expect(result.attemptId).toBe(coreAttemptId);
      expect(result.result.ok).toBe(true);

      const settledDb = new DatabaseSync(`${stack.coreDataDir}/taki.db`, { readOnly: true });
      try {
        const terminal = settledDb.prepare("SELECT state, outcome FROM run_effects WHERE effect_id = ?").get(effectId) as Record<string, unknown> | undefined;
        expect(terminal).toEqual({ state: "terminal", outcome: "completed" });
        const events = settledDb.prepare("SELECT kind FROM run_events WHERE run_id = ? AND kind IN ('effect.intent_committed','effect.settled') ORDER BY seq").all(frame.execute.control.runId) as { kind: string }[];
        expect(events.map((event) => event.kind)).toEqual(["effect.intent_committed", "effect.settled"]);
      } finally {
        settledDb.close();
      }
      expect(stack.audit().filter((entry) => entry.capability === "process-list")).toHaveLength(1);
    });
  }, 120_000);

  it("keeps an ask-classified Host effect in waiting until Approval, then resumes the same Effect", async () => {
    await withStack({ devTrigger: true, nodeWsRelay: true, autoApprove: "allow-once" }, async (stack) => {
      const operator = await stack.operator();
      const drive = triggerCapability(operator, { capability: "exec", input: { command: "hostname" }, timeoutMs: 60_000, lifecycle: true });
      const prompt = await Promise.race([
        awaitApprovalRequest(operator),
        drive.then((result) => { throw new Error(`drive settled before Approval: ${JSON.stringify(result)}`); }),
      ]);
      expect(prompt.presentation.capabilityLabel).toBe("执行命令");
      const waitingDb = new DatabaseSync(`${stack.coreDataDir}/taki.db`, { readOnly: true });
      let waitingEffectId = "";
      let waitingRunId: string;
      try {
        const rows = waitingDb.prepare("SELECT run_id, effect_id, state, approval_ref_json FROM run_effects WHERE state = 'waiting' ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
        const waiting = rows.find((row) => {
          try { return (JSON.parse(String(row.approval_ref_json)) as { approvalId?: string }).approvalId === prompt.approvalId; } catch { return false; }
        });
        expect(waiting).toMatchObject({ state: "waiting" });
        waitingEffectId = String(waiting?.effect_id);
        waitingRunId = String(waiting?.run_id);
      } finally {
        waitingDb.close();
      }
      const acknowledged = await respondApproval(operator, {
        approvalId: prompt.approvalId,
        choice: "allow_once",
        expectedApprovalGeneration: prompt.approvalGeneration,
      });
      expect(acknowledged.status).toBe("accepted");
      const result = await drive as { runId: string; attemptId: string; result: { ok: boolean } };
      expect(result.result.ok).toBe(true);
      expect(result.runId).toBe(waitingRunId);
      const settledDb = new DatabaseSync(`${stack.coreDataDir}/taki.db`, { readOnly: true });
      try {
        expect(settledDb.prepare("SELECT state, outcome FROM run_effects WHERE effect_id = ?").get(waitingEffectId))
          .toEqual({ state: "terminal", outcome: "completed" });
        const events = (settledDb.prepare("SELECT kind, payload_json FROM run_events WHERE run_id = ? ORDER BY seq").all(waitingRunId) as Array<{ kind: string; payload_json: string }>)
          .filter((event) => ["effect.waiting", "effect.intent_committed", "effect.settled"].includes(event.kind))
          .filter((event) => {
            try { return (JSON.parse(event.payload_json) as { effectId?: string }).effectId === waitingEffectId; } catch { return false; }
          });
        expect(events.map((event) => event.kind)).toEqual(["effect.waiting", "effect.intent_committed", "effect.settled"]);
      } finally {
        settledDb.close();
      }
    });
  }, 120_000);

  it("settles a disconnected unsafe Host execution as outcome_unknown without leaking its command to Core logs", async () => {
    const command = "ping 127.0.0.1 -n 30 -w 1000";
    await withStack({
      devTrigger: true,
      nodeWsRelay: true,
      autoApprove: "allow-once",
      execPolicy: { mode: "allowlist", allowlist: ["ping"] },
    }, async (stack) => {
      await stack.setPermissionLevel("relaxed");
      const relay = stack.relay();
      if (!relay) throw new Error("relay was not configured");
      const paused = relay.pauseNextExecute();
      const drive = triggerCapability(await stack.operator(), { capability: "exec", input: { command }, timeoutMs: 60_000, lifecycle: true });
      const frame = await Promise.race([
        paused,
        drive.then((result) => { throw new Error(`drive settled before unsafe execute: ${JSON.stringify(result)}`); }),
      ]);
      const effectId = frame.execute.control.effectId;
      if (!effectId) throw new Error("unsafe execute frame lost its Core Effect id");
      frame.release();
      await waitFor(() => stack.audit().some((entry) => entry.capability === "exec" && entry.command === command));
      await stack.killNode();

      const result = await drive as { result: { ok: boolean; code?: string; state?: string } };
      expect(result.result).toMatchObject({ ok: false, code: "OUTCOME_UNKNOWN", state: "outcome_unknown" });
      const db = new DatabaseSync(`${stack.coreDataDir}/taki.db`, { readOnly: true });
      try {
        expect(db.prepare("SELECT state, outcome FROM run_effects WHERE effect_id = ?").get(effectId))
          .toEqual({ state: "terminal", outcome: "outcome_unknown" });
      } finally {
        db.close();
      }
      const logs = `${stack.core.stdout.lines().join("\n")}\n${stack.core.stderr.lines().join("\n")}`;
      expect(logs).not.toContain(command);
    });
  }, 120_000);
});

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition did not become true before timeout");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
