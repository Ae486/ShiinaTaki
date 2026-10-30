/**
 * INPUT: trusted parent/owner work, authenticated user controls and existing Runtime owners
 * OUTPUT: durable addressed acceptance plus bounded independent shared-Agent executions
 * POS: core/harness — delegation coordinator; repositories own facts and TurnQueue owns execution lanes
 */
import type { ContextMaterial, SubagentControlResult, SubagentInput, SubagentSender, SubagentTarget } from "@taki/shared";
import { digestRunValue } from "../db/run-row-mappers.ts";
import { subagentLaneKey } from "../agents/work-scope.ts";
import { executeSubagent, workHasUncertainEffects, workNeedsExecution } from "./subagent-execution.ts";
import { assertSubagentCharacter, listSubagents, subagentHistory, subagentResult, subagentSummary } from "./subagent-queries.ts";
import { type BoundSubagentWork, type DelegateWork, type SubagentDependencies, type SubagentState, type SubagentWorkBinding } from "./subagent-state.ts";

export interface SubagentAddressedInput {
  characterId: string; target: SubagentTarget; operationKey: string; direction: string; materials: ContextMaterial[];
}
export interface SubagentAcceptance {
  signal?: AbortSignal;
  onAccepted?(work: SubagentInput): void | Promise<void>;
}

export function createSubagentService(deps: SubagentDependencies) {
  const state: SubagentState = { deps, bindings: new Map(), active: new Map(), work: new Set(), closing: false, scheduled: false,
    schedule: () => schedule(state), completionHint: () => undefined };
  deps.runRepo.onTerminalCommit((fact) => {
    const scope = deps.executions.scope(fact.run.runId);
    if (!scope) return;
    const child = scope.kind === "subagent" ? scope.subagentId : deps.executions.get(scope.completionId).subagentId;
    deps.changed(fact.run.characterId, child);
    queueMicrotask(() => { if (!state.closing) { state.schedule(); state.completionHint(); } });
  });
  return {
    state,
    delegate: (binding: SubagentWorkBinding, input: DelegateWork, acceptance: SubagentAcceptance = {}) => acceptWork(state, binding, input, acceptance),
    submitOwnedWork: (binding: SubagentWorkBinding, input: DelegateWork) => acceptWork(state, binding, input, {}),
    send: (input: SubagentAddressedInput, sender: SubagentSender) => acceptAddressed(state, input, sender, false),
    continue: (input: SubagentAddressedInput, sender: SubagentSender) => acceptAddressed(state, input, sender, true),
    stop: (input: { characterId: string; target: SubagentTarget }, origin: "user" | "parent") => stopChild(state, input, origin),
    yieldOwnedWork: (target: SubagentTarget) => yieldOwned(state, target),
    resumeOwnedWork(binding: SubagentWorkBinding, input: SubagentAddressedInput) {
      const root = deps.inputs.get(input.target.workInputId);
      state.bindings.set(root.inputId, { root, binding, resume: false });
      return acceptAddressed(state, input, { kind: "core", ownerRef: binding.source?.ownerRef ?? "core.subagent-owner" }, false);
    },
    list: (input: Parameters<typeof listSubagents>[1]) => listSubagents(state, input),
    history: (input: Parameters<typeof subagentHistory>[1]) => subagentHistory(state, input),
    result: (input: Parameters<typeof subagentResult>[1]) => subagentResult(state, input),
    summary: (subagentId: string) => subagentSummary(state, subagentId),
    released() {
      for (const bound of state.bindings.values()) if (bound.deferred === "source_unavailable") bound.deferred = undefined;
      state.schedule(); state.completionHint();
    },
    async close() {
      state.closing = true;
      for (const active of state.active.values()) {
        if (active.runId) deps.runs.requestCancel(active.runId, "core shutdown");
        active.controller.abort("core shutdown");
      }
      await Promise.allSettled([...state.work]);
    },
  };
}
export type SubagentService = ReturnType<typeof createSubagentService>;

async function acceptWork(state: SubagentState, binding: SubagentWorkBinding, input: DelegateWork, acceptance: SubagentAcceptance): Promise<SubagentControlResult> {
  if (state.closing || acceptance.signal?.aborted) throw new Error("SUBAGENT_ACCEPTANCE_CANCELLED");
  const { deps } = state;
  const parent = deps.runs.status(binding.parentRunId).run;
  if (parent.characterId !== input.characterId || !["running", "waiting"].includes(parent.state)) throw new Error("SUBAGENT_PARENT_UNAVAILABLE");
  let accepted: SubagentInput | undefined;
  deps.db.transaction(() => {
    const previous = deps.db.prepare("SELECT input_id FROM subagent_inputs WHERE sender_run_id=:run AND operation_key=:key")
      .get({ run: binding.parentRunId, key: input.operationKey });
    let subagentId = input.subagentId;
    if (previous && !subagentId) {
      const existing = deps.inputs.get(String(previous.input_id));
      const child = deps.children.get(existing.subagentId);
      if (child.label !== input.label || digestRunValue(child.initialContext) !== digestRunValue(input.initialContext)) throw new Error("SUBAGENT_INPUT_IDEMPOTENCY_CONFLICT");
      subagentId = child.subagentId;
    }
    if (!subagentId) subagentId = deps.children.create({ characterId: input.characterId, createdByRunId: binding.parentRunId,
      label: input.label, initialContext: input.initialContext }).subagentId;
    assertSubagentCharacter(state, input.characterId, subagentId);
    assertPendingCapacity(state, subagentId);
    accepted = deps.inputs.accept({ subagentId, operationKey: input.operationKey, sender: { kind: "parent", runId: binding.parentRunId },
      direction: input.direction, materials: input.materials,
      input: { kind: "work", completionPolicy: input.completionPolicy, lifetimeMinutes: input.lifetimeMinutes, toolSelection: input.toolSelection } }).input;
  });
  if (!accepted) throw new Error("SUBAGENT_ACCEPTANCE_FAILED");
  const root = accepted;
  if (!state.bindings.has(root.inputId)) state.bindings.set(root.inputId, { root, binding: { ...binding,
    parentToolNames: binding.parentToolNames ? Object.freeze([...binding.parentToolNames]) : undefined }, resume: false });
  try { await acceptance.onAccepted?.(root); }
  catch { deps.reportError("SUBAGENT_REPLY_ACCEPTANCE_UNAVAILABLE"); }
  finally { deps.changed(input.characterId, root.subagentId); state.schedule(); }
  return { conversation: subagentSummary(state, root.subagentId), input: root, cancellationRequested: false };
}

function acceptAddressed(state: SubagentState, input: SubagentAddressedInput, sender: SubagentSender, continuation: boolean): SubagentControlResult {
  if (state.closing) throw new Error("SUBAGENT_CLOSED");
  const { deps } = state;
  assertSubagentCharacter(state, input.characterId, input.target.subagentId);
  const root = deps.inputs.get(input.target.workInputId);
  if (root.subagentId !== input.target.subagentId || root.kind !== "work") throw new Error("SUBAGENT_WORK_MISMATCH");
  const bound = state.bindings.get(root.inputId);
  if (continuation && (!bound || workHasUncertainEffects(state, bound))) throw new Error("SUBAGENT_CONTINUE_REQUIRES_RECONCILIATION");
  assertPendingCapacity(state, root.subagentId);
  const accepted = deps.inputs.accept({ subagentId: input.target.subagentId, operationKey: input.operationKey,
    sender, direction: input.direction, materials: input.materials, input: continuation
      ? { kind: "continue", workInputId: root.inputId, expectedControlVersion: input.target.expectedControlVersion }
      : { kind: "message", workInputId: root.inputId, expectedControlVersion: input.target.expectedControlVersion,
        expectedRunId: input.target.expectedRunId } }).input;
  if (bound) bound.deferred = undefined;
  deps.changed(input.characterId, root.subagentId); state.schedule(); state.completionHint();
  return { conversation: subagentSummary(state, root.subagentId), input: accepted, cancellationRequested: false };
}

function stopChild(state: SubagentState, input: { characterId: string; target: SubagentTarget }, origin: "user" | "parent"): SubagentControlResult {
  assertSubagentCharacter(state, input.characterId, input.target.subagentId);
  let cancellationRequested = false;
  const result = state.deps.children.stop({ target: input.target, origin, cancelRunTx: (runId) => {
    cancellationRequested = state.deps.runs.requestCancel(runId, `${origin} child stop`);
  } });
  if (result.conversation.activeRunId) state.deps.turns.cancelExact({ characterId: input.characterId, runId: result.conversation.activeRunId,
    scopeKey: subagentLaneKey(result.conversation.subagentId), reason: `${origin} child stop` });
  // Admission capture may not have linked a Run yet; the durable latch is already committed.
  state.active.get(input.target.subagentId)?.controller.abort(`${origin} child stop`);
  state.deps.changed(input.characterId, input.target.subagentId);
  return { conversation: subagentSummary(state, input.target.subagentId), input: null, cancellationRequested };
}

function yieldOwned(state: SubagentState, target: SubagentTarget): boolean {
  const child = state.deps.children.get(target.subagentId);
  if (child.controlVersion !== target.expectedControlVersion || child.activeRunId !== target.expectedRunId) throw new Error("SUBAGENT_CONTROL_CONFLICT");
  const active = state.active.get(target.subagentId);
  if (!active || active.workInputId !== target.workInputId || active.controller.signal.aborted) return false;
  active.yielded = true;
  if (active.runId) state.deps.runs.requestCancel(active.runId, "owner_yield");
  active.controller.abort("owner_yield"); return true;
}

function assertPendingCapacity(state: SubagentState, subagentId: string): void {
  const count = state.deps.db.prepare("SELECT count(*) AS total FROM subagent_inputs WHERE subagent_id=:id AND consumed_run_id IS NULL")
    .get({ id: subagentId });
  if (Number(count?.total ?? 0) >= 1000) throw new Error("SUBAGENT_INPUT_CAPACITY");
}

function schedule(state: SubagentState): void {
  if (state.closing || state.scheduled) return;
  state.scheduled = true;
  queueMicrotask(() => {
    state.scheduled = false;
    for (const bound of state.bindings.values()) startPending(state, bound);
  });
}

function startPending(state: SubagentState, bound: BoundSubagentWork): void {
  const { deps } = state; const child = deps.children.get(bound.root.subagentId);
  if (state.closing || bound.deferred || child.stopOrigin || child.activeRunId || state.active.has(child.subagentId)
    || Date.now() >= Date.parse(bound.root.workExpiresAt) || !workNeedsExecution(state, bound)) return;
  if (workHasUncertainEffects(state, bound)) { bound.deferred = "reconciliation_required"; return; }
  if (state.active.size >= 16 || [...state.active.values()].filter((entry) => entry.characterId === child.characterId).length >= 4) return;
  const release = deps.queue.tryAcquireBackground(subagentLaneKey(child.subagentId));
  if (!release) return;
  const characterRelease = bound.binding.scheduling === "yieldable_character_background" ? deps.queue.tryAcquireBackground(child.characterId) : undefined;
  if (bound.binding.scheduling === "yieldable_character_background" && !characterRelease) { release(); return; }
  const active = { characterId: child.characterId, subagentId: child.subagentId, workInputId: bound.root.inputId,
    controller: new AbortController(), yielded: false };
  state.active.set(child.subagentId, active); bound.resume = false;
  // Move a dispatched purpose behind the others; repeated corrections cannot monopolize its child's queue.
  state.bindings.delete(bound.root.inputId); state.bindings.set(bound.root.inputId, bound);
  const work = executeSubagent(state, bound, active).catch(() => { bound.deferred = "source_unavailable"; deps.reportError("SUBAGENT_EXECUTION_REFUSED"); })
    .finally(() => {
      state.active.delete(child.subagentId); state.work.delete(work); release(); characterRelease?.();
      deps.changed(child.characterId, child.subagentId);
      const runId = state.deps.children.get(child.subagentId).activeRunId;
      if (!runId) state.schedule();
      state.completionHint();
    });
  state.work.add(work);
}
