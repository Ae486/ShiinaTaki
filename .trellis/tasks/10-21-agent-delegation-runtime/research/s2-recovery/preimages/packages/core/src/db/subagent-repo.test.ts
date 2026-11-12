import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunOutcome, SubagentInput, SubagentProposal, TriggerRequest, RunEvent, ParentContinuationProposal } from "@taki/shared";
import { openDatabase, type Database } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { createRunRepo, type RunAdmissionInput } from "./run-repo.ts";
import { createSubagentRepo } from "./subagent-repo.ts";
import { createSubagentInputRepo } from "./subagent-input-repo.ts";
import { createSubagentExecutionRepo } from "./subagent-execution-repo.ts";
import { createRunMessageRepo } from "./run-message-repo.ts";
import { createRunEventRepo } from "./run-event-repo.ts";
import { createRunEventLiveBus } from "./run-event-live.ts";
import { createEffectRepo } from "./effect-repo.ts";
import { createEffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createRunService } from "../harness/run-service.ts";
import { createRecoveryCoordinator } from "../harness/recovery-coordinator.ts";
import { digestRunValue } from "./run-row-mappers.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); vi.useRealTimers(); });

function request(key: string, overrides: Partial<TriggerRequest> = {}): TriggerRequest {
  return { triggerRequestId: key, idempotencyKey: key, characterId: "taki", initiator: "subagent",
    provenance: { provider: "core.subagent" }, deliveryClass: "internal", contextMode: "autonomous", ...overrides };
}
function snapshot(input: TriggerRequest): RunAdmissionInput["snapshot"] {
  return { schemaVersion: "slice1.v1", characterId: input.characterId, initiator: input.initiator,
    provenance: input.provenance, deliveryClass: input.deliveryClass, contextMode: input.contextMode,
    modelProvider: "test", modelId: "test", primaryHostId: "core", hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64),
    governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 },
    memory: { providerId: "legacy-markdown", contractVersion: 1, capabilityDigest: "b".repeat(64),
      capabilities: { providerId: "legacy-markdown", contractVersion: 1, retain: true, recall: true, reflect: false,
        edit: false, invalidate: true, restore: false, conditionalMutation: false, idempotentWrites: false,
        sparseRetrieval: true, vectorRetrieval: "unavailable", derivedMemoryRead: false } },
    contextDecision: { sourceCategories: ["character"], tokenAccounting: "unknown" }, replayDecision: { status: "not_captured" },
    budget: {}, implementation: { runtimeVersion: "test", schemaVersion: "slice1.v1" }, sourceRefs: [] };
}

function fixture() {
  const errors: unknown[] = [];
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS, onAfterCommitError: (error) => { errors.push(error); } }); dbs.push(db);
  const events: RunEvent[] = [];
  const eventRepo = createRunEventRepo(db);
  const live = createRunEventLiveBus(undefined, (batch) => { events.push(...batch); });
  const executions = createSubagentExecutionRepo(db);
  const terminal = vi.fn(); executions.linkedState.afterTerminalCommit = terminal;
  const runs = createRunRepo(db, eventRepo, { liveBus: live, linkedState: executions.linkedState });
  const inputs = createSubagentInputRepo(db); const children = createSubagentRepo(db); const messages = createRunMessageRepo(db);
  const effects = createEffectRepo(db, eventRepo, live);
  const parentRequest = request("parent", { initiator: "primary", contextMode: "primary", deliveryClass: "class_a", provenance: { provider: "chat" } });
  const parent = runs.admit({ runId: randomUUID(), request: parentRequest, snapshot: snapshot(parentRequest), provider: "test", modelId: "test" });
  const child = children.create({ characterId: "taki", createdByRunId: parent.run.runId, label: "Research", initialContext: { kind: "fresh" } });
  const work = (key: string, policy: "record_only" | "request_parent" = "request_parent") => inputs.accept({
    subagentId: child.subagentId, operationKey: key, sender: { kind: "parent", runId: parent.run.runId },
    direction: key, materials: [], input: { kind: "work", completionPolicy: policy, lifetimeMinutes: 30, toolSelection: { mode: "allow", names: [] } },
  }).input;
  const link = (root: SubagentInput) => ({ kind: "subagent" as const, triggerInputId: root.inputId,
    token: { subagentId: child.subagentId, workInputId: root.workInputId, throughWorkSeq: inputs.latestWorkSeq(root.workInputId),
      controlVersion: children.get(child.subagentId).controlVersion }, validateTx: () => {} });
  const admit = (root: SubagentInput, overrides: Partial<TriggerRequest> = {}) => {
    const req = request(`execute:${root.inputId}`, { deadlineAt: root.workExpiresAt, provenance: { provider: "core.subagent", parentRunId: parent.run.runId }, ...overrides });
    return runs.admit({ runId: randomUUID(), request: req, snapshot: snapshot(req), provider: "test", modelId: "test", linked: link(root) });
  };
  const settle = (admitted: ReturnType<typeof admit>, outcome: RunOutcome = "completed") => runs.settle({
    runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, outcome, retryability: "not_retryable" });
  const propose = (admitted: ReturnType<typeof admit>, proposal: SubagentProposal = { text: "Useful answer" }) => executions.recordProposal({
    runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, workToken: executions.token(admitted.run.runId), proposal, digest: digestRunValue(proposal) });
  return { db, errors, events, eventRepo, live, runs, children, inputs, executions, messages, effects, parent, child, work, link, admit, settle, propose, terminal };
}

describe("delegation inputs and linked admission", () => {
  it("captures work expiry once before any Run, inherits it, and never renews it through duplicate/retry/reuse", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-22T00:00:00.000Z"));
    const f = fixture(); const work = f.work("A");
    expect(work.workExpiresAt).toBe("2026-10-22T00:30:00.000Z");
    vi.setSystemTime(new Date("2026-10-22T00:05:00.000Z"));
    expect(f.work("A").workExpiresAt).toBe(work.workExpiresAt);
    expect(() => f.inputs.accept({ subagentId: f.child.subagentId, operationKey: "A", sender: { kind: "parent", runId: f.parent.run.runId },
      direction: "A", materials: [], input: { kind: "work", completionPolicy: "request_parent", lifetimeMinutes: 60, toolSelection: { mode: "allow", names: [] } } })).toThrow("IDEMPOTENCY_CONFLICT");
    const message = f.inputs.accept({ subagentId: f.child.subagentId, operationKey: "extra", sender: { kind: "user" }, direction: "Extra", materials: [],
      input: { kind: "message", workInputId: work.inputId, expectedControlVersion: 0 } }).input;
    expect(message.workExpiresAt).toBe(work.workExpiresAt);
    expect(() => f.admit(work, { deadlineAt: undefined })).toThrow("DEADLINE_MISMATCH");
    expect(() => f.admit(work, { deadlineAt: "2026-10-22T01:00:00.000Z" })).toThrow("DEADLINE_MISMATCH");
    const first = f.admit(work); f.runs.start(first.run.runId, first.attempt.attemptId);
    const retry = f.runs.retry(first.run.runId, first.attempt.attemptId, "context overflow");
    expect(retry.run.deadlineAt).toBe(work.workExpiresAt);
    f.runs.settle({ runId: first.run.runId, attemptId: retry.run.activeAttemptId!, outcome: "completed", retryability: "not_retryable" });
    const reused = f.admit(work, { triggerRequestId: "resume", idempotencyKey: "resume" });
    expect(reused.run.deadlineAt).toBe(work.workExpiresAt);
    f.runs.cancel(reused.run.runId); f.runs.start(reused.run.runId, reused.attempt.attemptId);
    expect(() => f.db.prepare("UPDATE subagent_inputs SET work_expires_at='2027-01-01T00:00:00Z' WHERE input_id=:id").run({ id: work.inputId })).toThrow("IMMUTABLE");
    vi.setSystemTime(new Date("2026-10-22T00:31:00.000Z"));
    expect(() => f.admit(work, { triggerRequestId: "expired", idempotencyKey: "expired" })).toThrow("WORK_EXPIRED");
  });

  it("rejects stale addressed controls atomically and pages child history by actual cross-Run insertion order", () => {
    const f = fixture(); const a = f.work("A"); const first = f.admit(a); f.runs.start(first.run.runId, first.attempt.attemptId);
    expect(() => f.inputs.accept({ subagentId: f.child.subagentId, operationKey: "stale", sender: { kind: "user" }, direction: "Stale", materials: [],
      input: { kind: "message", workInputId: a.inputId, expectedControlVersion: 0 } })).toThrow("CONTROL_CONFLICT");
    f.messages.recordStep({ runId: first.run.runId, attemptId: first.attempt.attemptId,
      batch: { stepNumber: 0, entryKind: "output", messages: [{ role: "assistant", content: "A output" }] } });
    f.settle(first);
    const second = f.admit(f.work("B")); f.runs.start(second.run.runId, second.attempt.attemptId);
    f.messages.recordStep({ runId: second.run.runId, attemptId: second.attempt.attemptId,
      batch: { stepNumber: 0, entryKind: "output", messages: [{ role: "assistant", content: "B output" }] } });
    const page = f.messages.history({ subagentId: f.child.subagentId, limit: 1, replay: true });
    expect(page[0]?.content).toBe("A output");
    expect(f.messages.history({ subagentId: f.child.subagentId, afterSeq: page[0]!.seq, replay: true })[0]?.content).toBe("B output");
  });

  it("keeps independent B separate from A and deduplicates input operations including explicit empty tools", () => {
    const f = fixture(); const a = f.work("A"); const active = f.admit(a); const control = f.children.get(f.child.subagentId).controlVersion;
    const b = f.work("B", "record_only");
    const correction = f.inputs.accept({ subagentId: f.child.subagentId, operationKey: "correct-A", sender: { kind: "user" },
      direction: "Use the corrected date", materials: [], input: { kind: "message", expectedControlVersion: f.children.get(f.child.subagentId).controlVersion, workInputId: a.inputId } });
    expect([a.inputSeq, b.inputSeq, correction.input.inputSeq]).toEqual([1, 2, 3]);
    expect([a.workSeq, b.workSeq, correction.input.workSeq]).toEqual([1, 1, 2]);
    expect(correction.input.completionPolicy).toBe("request_parent");
    expect(f.children.get(f.child.subagentId)).toMatchObject({ controlVersion: control, activeRunId: active.run.runId });
    expect(a.toolSelection).toEqual({ mode: "allow", names: [] });
    expect(f.work("A").inputId).toBe(a.inputId);
    expect(() => f.work("A", "record_only")).toThrow("SUBAGENT_INPUT_IDEMPOTENCY_CONFLICT");
    expect(() => f.admit(b)).toThrow("SUBAGENT_CONTROL_CONFLICT");
  });

  it("captures selected context once and excludes raw tool inputs while retaining actual paired results", () => {
    const f = fixture();
    const value = f.children.create({ characterId: "taki", createdByRunId: f.parent.run.runId, label: "Selected",
      initialContext: { kind: "snapshot", materials: [], messages: [
        { role: "assistant", content: "", parts: [{ type: "tool-call", toolCallId: "call", toolName: "read", input: { secret: "private" } }] },
        { role: "tool", content: "Read failed", parts: [{ type: "tool-result", toolCallId: "call", toolName: "read",
          output: { type: "json", value: { ok: false, error: "unavailable" } }, sourceMaterials: [{ key: "document", source: { label: "Interview" } }] }] },
      ] } });
    expect(JSON.stringify(f.children.get(value.subagentId))).not.toContain("private");
    expect(JSON.stringify(f.children.get(value.subagentId))).toContain("unavailable");
    expect(() => f.db.prepare("UPDATE subagent_conversations SET initial_context_json='{}' WHERE subagent_id=:id").run({ id: value.subagentId })).toThrow("IMMUTABLE");
  });

  it("reuses only an exact linked admission and rolls back every row when linked admission fails", () => {
    const f = fixture(); const work = f.work("A"); const req = request("linked", { deadlineAt: work.workExpiresAt }); const link = f.link(work);
    const input = { runId: randomUUID(), request: req, snapshot: snapshot(req), provider: "test", modelId: "test", linked: link };
    const first = f.runs.admit(input);
    f.runs.start(first.run.runId, first.attempt.attemptId);
    expect(f.runs.admit({ ...input, runId: randomUUID() }).reused).toBe(true);
    expect(() => f.runs.admit({ ...input, linked: { ...link, token: { ...link.token, throughWorkSeq: 2 } } })).toThrow("SUBAGENT_ADMISSION_CONFLICT");
    const b = f.work("B"); const count = f.events.length;
    f.settle(first);
    const before = f.db.prepare("SELECT count(*) n FROM runs").get()?.n;
    f.db.exec("CREATE TRIGGER refuse_child BEFORE INSERT ON subagent_executions BEGIN SELECT RAISE(ABORT,'linked failure'); END");
    expect(() => f.admit(b)).toThrow("linked failure");
    expect(f.db.prepare("SELECT count(*) n FROM runs").get()?.n).toBe(before);
    expect(f.children.get(f.child.subagentId).activeRunId).toBeNull();
    expect(f.events.length).toBe(count + 2);
  });

  it("keeps the user latch through parent interruption/messages and requires an explicit exact user continuation", () => {
    const f = fixture(); const work = f.work("A");
    const target = { subagentId: f.child.subagentId, workInputId: work.inputId, expectedControlVersion: 0 };
    expect(f.children.stop({ target, origin: "user" }).changed).toBe(true);
    expect(f.children.stop({ target: { ...target, expectedControlVersion: 1 }, origin: "parent" }).changed).toBe(false);
    expect(() => f.admit(work)).toThrow("SUBAGENT_STOPPED");
    const input = { subagentId: f.child.subagentId, operationKey: "continue", direction: "", materials: [],
      input: { kind: "continue" as const, workInputId: work.inputId, expectedControlVersion: 1 } };
    expect(() => f.inputs.accept({ ...input, sender: { kind: "parent", runId: f.parent.run.runId } })).toThrow("SUBAGENT_USER_CONTINUE_REQUIRED");
    const continued = f.inputs.accept({ ...input, sender: { kind: "user" } });
    expect(f.children.get(f.child.subagentId)).toMatchObject({ stopOrigin: null, controlVersion: 2 });
    expect(f.inputs.accept({ ...input, sender: { kind: "user" } })).toMatchObject({ reused: true, input: { inputId: continued.input.inputId } });
  });

  it("atomically rolls back the stop latch when exact Run cancellation fails", () => {
    const f = fixture(); const work = f.work("A"); const admitted = f.admit(work);
    expect(() => f.children.stop({ target: { subagentId: f.child.subagentId, workInputId: work.inputId,
      expectedRunId: admitted.run.runId, expectedControlVersion: 1 }, origin: "user", cancelRunTx: () => { throw new Error("cancel failed"); } })).toThrow("cancel failed");
    expect(f.children.get(f.child.subagentId)).toMatchObject({ stopOrigin: null, controlVersion: 1 });
  });
});

describe("canonical delegation terminal participation", () => {
  it.each([false, true])("binds the proposal to exact consumed input and accepts only a current replacement (replace=%s)", (replace) => {
    const f = fixture(); const work = f.work("A"); const admitted = f.admit(work); f.runs.start(admitted.run.runId, admitted.attempt.attemptId);
    f.propose(admitted, { text: "Old body", sourceContext: { materials: [{ label: "Old source" }] } });
    f.messages.recordStep({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId,
      batch: { stepNumber: 0, entryKind: "output", messages: [{ role: "assistant", content: "Old body" }] } });
    const correction = f.inputs.accept({ subagentId: f.child.subagentId, operationKey: "correct", sender: { kind: "user" }, direction: "New input", materials: [],
      input: { kind: "message", workInputId: work.inputId, expectedControlVersion: 1 } }).input;
    const token = { ...f.executions.token(admitted.run.runId), throughWorkSeq: 2 };
    f.effects.prepareIntent({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, kind: "model", sourceRef: { type: "model", provider: "test", modelId: "test" },
      inputDigest: "f".repeat(64), replayPosture: "never", onCommitIntent: (effect) => f.messages.recordModelInputs({ effect, token, stepNumber: 1, inputIds: [work.inputId, correction.inputId] }) });
    if (replace) f.propose(admitted, { text: "Current body", sourceContext: { materials: [{ label: "Current source" }] } });
    f.settle(admitted);
    const result = f.executions.result(admitted.run.runId)!;
    if (replace) expect(result).toMatchObject({ completionState: "pending", child: { body: "Current body", outputKind: "validated", currentness: "current", throughWorkSeq: 2 } });
    else {
      expect(result).toMatchObject({ completionState: "pending", child: { body: null, outputKind: "none", currentness: "current", throughWorkSeq: 2 } });
      expect(result.child.sourceContext.materials).toBeUndefined();
    }
    expect(JSON.stringify(result)).not.toContain("Old source");
    expect(f.messages.history({ subagentId: f.child.subagentId }).some((row) => row.content === "Old body")).toBe(true);
  });

  it("accepts a genuinely newer current proposal identity while rejecting same-identity changes and stale Attempt callbacks", () => {
    const f = fixture(); const admitted = f.admit(f.work("A")); f.runs.start(admitted.run.runId, admitted.attempt.attemptId); f.propose(admitted);
    expect(() => f.propose(admitted, { text: "Different at same identity" })).toThrow("PROPOSAL_CONFLICT");
    const retry = f.runs.retry(admitted.run.runId, admitted.attempt.attemptId, "context overflow");
    expect(() => f.propose(admitted, { text: "Late old callback" })).toThrow("PROPOSAL_STALE");
    const current = { ...admitted, attempt: retry.attempts.find((attempt) => attempt.attemptId === retry.run.activeAttemptId)! };
    f.propose(current, { text: "Current answer" }); f.settle(current);
    expect(f.executions.result(admitted.run.runId)?.child).toMatchObject({ attemptId: current.attempt.attemptId, body: "Current answer", outputKind: "validated" });
  });

  it("does not reject an already committed admission when an observer terminalizes it and unused capture disposal throws", async () => {
    const f = fixture(); const work = f.work("A"); const publish = f.live.publish;
    f.live.publish = (events) => {
      publish(events);
      const admission = events.find((event) => event.kind === "run.admitted");
      if (!admission) return;
      f.runs.cancel(admission.runId);
      f.runs.start(admission.runId, f.runs.status(admission.runId).run.activeAttemptId!);
    };
    const disposed = vi.fn(() => { throw new Error("unused disposal failed"); });
    const service = createRunService({ repo: f.runs, provider: "test", modelId: "test",
      snapshot: { async capture(input) { return { snapshot: snapshot(input), context: { dispose: disposed } }; } } });
    const admitted = await service.admitLinked(request("observer-cancel", { deadlineAt: work.workExpiresAt }), { linked: f.link(work) });
    expect(admitted.run.state).toBe("cancelled"); expect(disposed).toHaveBeenCalledTimes(1);
    expect(service.context(admitted.run.runId)).toBeUndefined(); expect(f.errors).toHaveLength(1);
  });

  it.each([
    ["start-cancel", "cancelled"], ["start-deadline", "deadline_exceeded"], ["start-budget", "failed"],
    ["guard-cancel", "cancelled"], ["guard-deadline", "deadline_exceeded"], ["guard-budget", "failed"],
    ["public-settle", "completed"], ["recovery", "cancelled"],
  ] as const)("records and releases through %s using final outcome %s", async (path, outcome) => {
    const f = fixture(); const work = f.work("A"); const admitted = f.admit(work);
    const runId = admitted.run.runId; const attemptId = admitted.attempt.attemptId;
    if (path.startsWith("guard") || path === "public-settle") f.runs.start(runId, attemptId);
    if (path.endsWith("cancel") || path === "recovery") f.runs.cancel(runId);
    if (path.endsWith("deadline")) f.db.prepare("UPDATE runs SET deadline_at='2000-01-01T00:00:00.000Z' WHERE run_id=:id").run({ id: runId });
    if (path.endsWith("budget")) f.db.prepare("UPDATE runs SET budget_limit=0 WHERE run_id=:id").run({ id: runId });
    if (path.startsWith("start")) expect(f.runs.start(runId, attemptId).started).toBe(false);
    else if (path.startsWith("guard")) expect(f.runs.guardDispatch(runId, attemptId)).toBe(false);
    else if (path === "public-settle") f.settle(admitted);
    else {
      const restarted = createRunRepo(f.db, f.eventRepo, { linkedState: createSubagentExecutionRepo(f.db).linkedState });
      const recovery = createRecoveryCoordinator({ db: f.db, runs: restarted, effects: createEffectLifecycleService(f.effects) });
      await recovery.scan();
    }
    const result = f.executions.result(runId);
    expect(result).toMatchObject({ completionState: "pending", child: { runId, attemptId, outcome, body: null, outputKind: "none" } });
    expect(f.runs.status(runId).run.outcome).toBe(outcome);
    expect(f.children.get(f.child.subagentId).activeRunId).toBeNull();
    const old = JSON.stringify(result); const count = f.events.length;
    f.settle(admitted, "failed");
    expect(JSON.stringify(f.executions.result(runId))).toBe(old);
    expect(f.events).toHaveLength(count);
  });

  it.each(["cancelled", "deadline_exceeded", "outcome_unknown"] as const)("never accepts a success proposal beside %s", (outcome) => {
    const f = fixture(); const admitted = f.admit(f.work("A")); f.runs.start(admitted.run.runId, admitted.attempt.attemptId); f.propose(admitted);
    if (outcome === "cancelled") f.runs.cancel(admitted.run.runId);
    if (outcome === "deadline_exceeded") f.db.prepare("UPDATE runs SET deadline_at='2000-01-01T00:00:00.000Z' WHERE run_id=:id").run({ id: admitted.run.runId });
    f.settle(admitted, outcome === "outcome_unknown" ? outcome : "completed");
    expect(f.executions.result(admitted.run.runId)?.child).toMatchObject({ outcome, body: "Useful answer", outputKind: "partial" });
  });

  it("retains A/request-parent while independent B/record-only waits and parent stop leaves the child alone", () => {
    const f = fixture(); const a = f.work("A"); const admitted = f.admit(a); f.runs.start(admitted.run.runId, admitted.attempt.attemptId);
    const b = f.work("B", "record_only"); f.runs.cancel(f.parent.run.runId);
    expect(f.runs.status(admitted.run.runId).run.state).toBe("running");
    f.propose(admitted, { text: "A result", sourceContext: { materials: [{ label: "Selected source", speaker: "Narrator" }] } }); f.settle(admitted);
    expect(f.executions.result(admitted.run.runId)).toMatchObject({ completionState: "pending", child: { currentness: "current", body: "A result" } });
    const next = f.admit(b); f.runs.start(next.run.runId, next.attempt.attemptId); f.settle(next);
    expect(f.executions.result(next.run.runId)?.completionState).toBe("not_requested");
    expect(f.executions.pending().map((item) => item?.completionId)).toEqual([admitted.run.runId]);
  });

  it("withholds only a result with an unconsumed correction to its own work", () => {
    const f = fixture(); const a = f.work("A"); const admitted = f.admit(a); f.runs.start(admitted.run.runId, admitted.attempt.attemptId);
    f.work("B", "record_only");
    f.inputs.accept({ subagentId: f.child.subagentId, operationKey: "steer", sender: { kind: "user" }, direction: "Correction", materials: [],
      input: { kind: "message", expectedControlVersion: f.children.get(f.child.subagentId).controlVersion, workInputId: a.inputId } });
    f.propose(admitted); f.settle(admitted);
    expect(f.executions.result(admitted.run.runId)).toMatchObject({ completionState: "withheld", completionReason: "superseded", child: { currentness: "superseded" } });
  });

  it("rolls back terminal Run/Attempt/Receipt/events, private final tail and child pointer when the participant fails", () => {
    const f = fixture(); const admitted = f.admit(f.work("A")); f.runs.start(admitted.run.runId, admitted.attempt.attemptId);
    f.messages.stageTerminal({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId,
      batch: { stepNumber: 0, entryKind: "partial", messages: [{ role: "assistant", content: "observed partial" }] } });
    const before = f.runs.status(admitted.run.runId); const count = f.events.length;
    f.db.exec("CREATE TRIGGER refuse_result BEFORE UPDATE OF result_json ON subagent_executions BEGIN SELECT RAISE(ABORT,'terminal failure'); END");
    expect(() => f.settle(admitted)).toThrow("terminal failure");
    expect(f.runs.status(admitted.run.runId)).toEqual(before);
    expect(f.messages.list({ runId: admitted.run.runId })).toEqual([]);
    expect(f.children.get(f.child.subagentId).activeRunId).toBe(admitted.run.runId);
    expect(f.events).toHaveLength(count); expect(f.terminal).not.toHaveBeenCalled();
  });

  it("defers context disposal and notifications to the outer commit, and isolates a throwing disposer", async () => {
    const f = fixture(); const disposed = vi.fn(() => { throw new Error("disposal failed"); });
    const service = createRunService({ repo: f.runs, provider: "test", modelId: "test",
      snapshot: { async capture(input) { return { snapshot: snapshot(input), context: { dispose: disposed } }; } } });
    const work = f.work("A"); const admitted = await service.admitLinked(request("service-child", { deadlineAt: work.workExpiresAt }), { linked: f.link(work) });
    service.start(admitted.run.runId, admitted.attempt.attemptId); const count = f.events.length;
    expect(() => f.db.transaction(() => { service.settle(admitted.run.runId, admitted.attempt.attemptId, "completed");
      expect(disposed).not.toHaveBeenCalled(); expect(f.events).toHaveLength(count); throw new Error("outer rollback"); })).toThrow("outer rollback");
    expect(service.context(admitted.run.runId)).toBeDefined(); expect(f.executions.result(admitted.run.runId)).toBeNull();
    f.db.transaction(() => { f.settle(admitted); expect(disposed).not.toHaveBeenCalled(); });
    expect(disposed).toHaveBeenCalledTimes(1); expect(f.errors).toHaveLength(1);
    expect(service.context(admitted.run.runId)).toBeUndefined(); expect(f.terminal).toHaveBeenCalledTimes(1);
    f.settle(admitted); expect(disposed).toHaveBeenCalledTimes(1);
  });

  it("rolls back linked settlement on deferred COMMIT failure without events or disposal", () => {
    const f = fixture(); const admitted = f.admit(f.work("A")); f.runs.start(admitted.run.runId, admitted.attempt.attemptId);
    const count = f.events.length;
    f.db.exec("CREATE TABLE commit_failure (id TEXT REFERENCES runs(run_id) DEFERRABLE INITIALLY DEFERRED)");
    expect(() => f.db.transaction(() => { f.settle(admitted); f.db.exec("INSERT INTO commit_failure VALUES ('missing')"); })).toThrow();
    expect(f.runs.status(admitted.run.runId).run.state).toBe("running");
    expect(f.executions.result(admitted.run.runId)).toBeNull(); expect(f.events).toHaveLength(count); expect(f.terminal).not.toHaveBeenCalled();
  });
});

describe("private model input receipts and parent synthesis", () => {
  it("keeps completed steps idempotent, partials distinct and stale Attempt callbacks unable to settle current work", () => {
    const f = fixture(); const admitted = f.admit(f.work("A")); f.runs.start(admitted.run.runId, admitted.attempt.attemptId);
    const batch = { stepNumber: 0, entryKind: "output" as const, messages: [{ role: "assistant" as const, content: "Completed visible step" }] };
    f.messages.recordStep({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, batch });
    f.messages.recordStep({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, batch });
    expect(() => f.messages.recordStep({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId,
      batch: { ...batch, messages: [{ role: "assistant", content: "different" }] } })).toThrow("RUN_MESSAGE_BATCH_CONFLICT");
    f.messages.recordStep({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId,
      batch: { stepNumber: 0, entryKind: "partial", messages: [{ role: "assistant", content: "Earlier partial" }] } });
    expect(f.messages.list({ runId: admitted.run.runId })).toHaveLength(2);
    expect(f.messages.list({ runId: admitted.run.runId, replay: true })).toHaveLength(1);
    f.runs.retry(admitted.run.runId, admitted.attempt.attemptId, "context overflow");
    f.settle(admitted);
    expect(f.executions.result(admitted.run.runId)).toBeNull();
    expect(() => f.messages.recordStep({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, batch })).toThrow("STALE_ATTEMPT");
  });

  it("revalidates the child stop token after asynchronous snapshot capture and disposes a refused capture", async () => {
    const f = fixture(); const work = f.work("A"); const disposed = vi.fn(); const linked = f.link(work);
    const service = createRunService({ repo: f.runs, provider: "test", modelId: "test", snapshot: { async capture(input) {
      await Promise.resolve();
      f.children.stop({ target: { subagentId: f.child.subagentId, workInputId: work.inputId, expectedControlVersion: 0 }, origin: "user" });
      return { snapshot: snapshot(input), context: { dispose: disposed } };
    } } });
    await expect(service.admitLinked(request("capture-race", { deadlineAt: work.workExpiresAt }), { linked })).rejects.toThrow("SUBAGENT_STOPPED");
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(f.executions.list({ subagentId: f.child.subagentId })).toEqual([]);
    expect(f.db.prepare("SELECT count(*) n FROM runs").get()?.n).toBe(1);
  });

  it.each(["internal_result", "no_action", "reply"] as const)("retains a completed parent %s decision without publishing speech", (decision) => {
    const f = fixture(); const admitted = f.admit(f.work("A")); f.runs.start(admitted.run.runId, admitted.attempt.attemptId); f.propose(admitted); f.settle(admitted);
    const group = f.executions.result(admitted.run.runId)!;
    const req = request(`subagent-completion:${admitted.run.runId}`, { deadlineAt: f.inputs.get(f.executions.get(admitted.run.runId).workInputId).workExpiresAt, provenance: { provider: "core.subagent-completion" }, payloadRef: admitted.run.runId });
    const parent = f.runs.admit({ runId: randomUUID(), request: req, snapshot: snapshot(req), provider: "test", modelId: "test",
      linked: { kind: "parent-continuation", completionId: admitted.run.runId, resultDigest: group.childDigest, validateTx: () => {} } });
    f.runs.start(parent.run.runId, parent.attempt.attemptId);
    const proposal: ParentContinuationProposal = decision === "no_action" ? { decision, reason: "Already answered", text: "Retained synthesis" }
      : { decision, text: "Retained synthesis" };
    f.executions.recordParentProposal({ runId: parent.run.runId, attemptId: parent.attempt.attemptId, proposal, digest: digestRunValue(proposal) });
    const retry = f.runs.retry(parent.run.runId, parent.attempt.attemptId, "context overflow");
    expect(() => f.executions.recordParentProposal({ runId: parent.run.runId, attemptId: parent.attempt.attemptId, proposal, digest: digestRunValue(proposal) })).toThrow("PROPOSAL_STALE");
    f.executions.recordParentProposal({ runId: parent.run.runId, attemptId: retry.run.activeAttemptId!, proposal, digest: digestRunValue(proposal) });
    f.runs.settle({ runId: parent.run.runId, attemptId: retry.run.activeAttemptId!, outcome: "completed", retryability: "not_retryable" });
    expect(f.executions.get(admitted.run.runId).parentResult?.decision).toBe(decision);
    expect(f.executions.result(admitted.run.runId)?.publication?.state).toBe(decision === "reply" ? "pending" : decision === "no_action" ? "no_action" : "internal_only");
    expect(f.db.prepare("SELECT count(*) n FROM timeline_messages").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT count(*) n FROM run_deliveries").get()?.n).toBe(0);
  });

  it("records only actual model intents, preserves first receipts across repeated calls/retries, and orders visible native steps", () => {
    const f = fixture(); const work = f.work("A"); const admitted = f.admit(work); f.runs.start(admitted.run.runId, admitted.attempt.attemptId);
    const token = f.executions.token(admitted.run.runId);
    const message = f.inputs.accept({ subagentId: f.child.subagentId, operationKey: "later", sender: { kind: "user" }, direction: "Later",
      materials: [], input: { kind: "message", expectedControlVersion: f.children.get(f.child.subagentId).controlVersion, workInputId: work.inputId } }).input;
    expect(f.inputs.get(work.inputId).consumed).toBeNull();
    const prepare = (step: number, ids: string[]) => f.effects.prepareIntent({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId,
      kind: "model", sourceRef: { type: "model", provider: "test", modelId: "test" }, inputDigest: "c".repeat(64), replayPosture: "never",
      onCommitIntent: (effect) => f.messages.recordModelInputs({ effect, token, stepNumber: step, inputIds: ids }) });
    const first = prepare(0, [work.inputId]);
    expect(f.inputs.get(message.inputId).consumed).toBeNull();
    prepare(0, [work.inputId]);
    expect(f.inputs.get(work.inputId).consumed?.effectId).toBe(first.effectId);
    expect(f.messages.list({ runId: admitted.run.runId })).toHaveLength(2);
    expect(f.messages.list({ runId: admitted.run.runId, replay: true })).toHaveLength(1);
    f.messages.recordStep({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, batch: { stepNumber: 0, entryKind: "output", messages: [
      { role: "assistant", content: "", parts: [{ type: "tool-call", toolCallId: "read", toolName: "read", input: { private: "secret" } }] },
      { role: "tool", content: "No matches", parts: [{ type: "tool-result", toolCallId: "read", toolName: "read", output: { type: "json", value: { ok: true, items: [] } },
        sourceMaterials: [{ key: "search", source: { reference: "doc:1" } }] }] },
    ] } });
    token.throughWorkSeq = 2; prepare(1, [message.inputId]);
    const rows = f.messages.list({ runId: admitted.run.runId, replay: true });
    expect(rows.map((row) => row.entryKind)).toEqual(["input", "output", "output", "input"]);
    expect(JSON.stringify(rows)).not.toContain("secret"); expect(JSON.stringify(rows)).toContain("doc:1");
    const next = f.runs.retry(admitted.run.runId, admitted.attempt.attemptId, "context overflow");
    const secondAttempt = next.run.activeAttemptId!;
    f.effects.prepareIntent({ runId: admitted.run.runId, attemptId: secondAttempt, kind: "model", sourceRef: { type: "model", provider: "test", modelId: "test" },
      inputDigest: "d".repeat(64), replayPosture: "never", onCommitIntent: (effect) => f.messages.recordModelInputs({ effect, token, stepNumber: 0, inputIds: [work.inputId, message.inputId] }) });
    expect(f.inputs.get(work.inputId).consumed?.attemptId).toBe(admitted.attempt.attemptId);
    expect(f.messages.list({ runId: admitted.run.runId, replay: true })).toHaveLength(4);
  });

  it("rolls back receipt and watermark if Effect insertion fails, and refuses a skipped pending input", () => {
    const f = fixture(); const work = f.work("A"); const admitted = f.admit(work); f.runs.start(admitted.run.runId, admitted.attempt.attemptId);
    const token = f.executions.token(admitted.run.runId);
    const input = { runId: admitted.run.runId, attemptId: admitted.attempt.attemptId, kind: "model" as const,
      sourceRef: { type: "model" as const, provider: "test", modelId: "test" }, inputDigest: "a".repeat(64), replayPosture: "never" as const };
    expect(() => f.effects.prepareIntent({ ...input, onCommitIntent: (effect) => f.messages.recordModelInputs({ effect, token, stepNumber: 0, inputIds: [] }) })).toThrow("BATCH_INCOMPLETE");
    f.db.exec("CREATE TRIGGER refuse_effect BEFORE INSERT ON run_effects BEGIN SELECT RAISE(ABORT,'effect failure'); END");
    expect(() => f.effects.prepareIntent({ ...input, onCommitIntent: (effect) => f.messages.recordModelInputs({ effect, token, stepNumber: 0, inputIds: [work.inputId] }) })).toThrow("effect failure");
    expect(f.inputs.get(work.inputId).consumed).toBeNull(); expect(f.messages.list({ runId: admitted.run.runId })).toEqual([]);
    expect(f.runs.status(admitted.run.runId).run.budgetUsed).toBe(0);
  });

  it("atomically links one parent synthesis with trusted main scope and retains a cancelled reply as partial internal evidence", async () => {
    const f = fixture(); const admitted = f.admit(f.work("A")); f.runs.start(admitted.run.runId, admitted.attempt.attemptId); f.propose(admitted); f.settle(admitted);
    const completion = f.executions.result(admitted.run.runId)!;
    const scopes: unknown[] = [];
    const service = createRunService({ repo: f.runs, provider: "test", modelId: "test",
      snapshot: { async capture(input, _run, options) { scopes.push(options?.workScope); return { snapshot: snapshot(input), context: {} }; } } });
    const req = request(`subagent-completion:${admitted.run.runId}`, { deadlineAt: f.inputs.get(f.executions.get(admitted.run.runId).workInputId).workExpiresAt, provenance: { provider: "core.subagent-completion", parentRunId: f.parent.run.runId }, payloadRef: admitted.run.runId });
    const linked = { kind: "parent-continuation" as const, completionId: admitted.run.runId, resultDigest: completion.childDigest, validateTx: () => {} };
    const parent = await service.admitLinked(req, { linked });
    expect((await service.admitLinked(req, { linked })).reused).toBe(true);
    expect(scopes[0]).toEqual({ kind: "parent-continuation", completionId: admitted.run.runId });
    expect(parent.snapshot.memory.capabilities.retain).toBe(true);
    service.start(parent.run.runId, parent.attempt.attemptId);
    const proposal: ParentContinuationProposal = { decision: "reply", text: "Synthesis", sourceContext: { materials: [{ label: "Interview" }] } };
    f.executions.recordParentProposal({ runId: parent.run.runId, attemptId: parent.attempt.attemptId, proposal, digest: digestRunValue(proposal) });
    service.requestCancel(parent.run.runId); service.settle(parent.run.runId, parent.attempt.attemptId, "completed");
    const result = f.executions.result(admitted.run.runId);
    expect(result).toMatchObject({ completionState: "admitted", parentRunId: parent.run.runId,
      parent: { outcome: "cancelled", outputKind: "partial", body: "Synthesis", decision: "unstructured" }, publication: { state: "internal_only" } });
    expect(f.executions.pending()).toEqual([]);
    expect(f.executions.setCompletion({ completionId: admitted.run.runId, state: "deferred", reason: "foreground_busy" })).toBe(false);
  });
});
