/**
 * INPUT: trusted parent/owner work, authenticated user controls and existing Runtime owners
 * OUTPUT: durable addressed acceptance plus bounded independent shared-Agent executions
 * POS: core/harness — delegation coordinator; repositories own facts and TurnQueue owns execution lanes
 */
import type { ContextMaterial, SubagentControlResult, SubagentInput, SubagentSender, SubagentTarget, SubagentWorkToken } from "@taki/shared";
import { digestRunValue } from "../db/run-row-mappers.ts";
import { subagentLaneKey } from "../agents/work-scope.ts";
import { executeSubagent, workHasUncertainEffects, workNeedsExecution } from "./subagent-execution.ts";
import { assertSubagentCharacter, listSubagents, subagentHistory, subagentResult, subagentSummary } from "./subagent-queries.ts";
import { checkWorkCurrent, type WorkCurrentness, type WorkPhase, type BoundSubagentWork, type DelegateWork, type SubagentDependencies, type SubagentState, type SubagentWorkBinding } from "./subagent-state.ts";
import { createSubagentCompletion } from "./subagent-completion.ts";
import { createMaterialSelection } from "./subagent-tool-materials.ts";
import { prepareSubagentInbox } from "./subagent-inbox-context.ts";
import type { ForegroundInboxInput } from "../agents/foreground-inbox.ts";
import { createSubagentEventRepo } from "../db/subagent-event-repo.ts";
import { createSubagentInboxRepo } from "../db/subagent-inbox-repo.ts";
import { createSubagentInboxExecution } from "./subagent-inbox-execution.ts";
import { createSubagentActivity } from "./subagent-activity.ts";
import { readSubagentConversation, readSubagentConversationBody } from "../db/subagent-conversation-repo.ts";
import { readSubagentInboxRecovery } from "../db/subagent-inbox-recovery-repo.ts";
import { createSubagentProgressRepo } from "../db/subagent-progress-repo.ts";
import { acceptDueSubagentCheckIn } from "../db/subagent-checkin-repo.ts";
import { SUBAGENT_CHECKIN_DEFAULTS } from "../config/subagent-config.ts";
import { readSubagentAttention } from "../db/subagent-attention-repo.ts";
import { resolveOrdinarySubagentTarget } from "./subagent-addressing.ts";

export interface SubagentAddressedInput {
  characterId: string; target: SubagentTarget; operationKey: string; direction: string; materials: ContextMaterial[]; replyToEventId?: string;
}
export interface SubagentAcceptance {
  signal?: AbortSignal;
  onAccepted?(work: SubagentInput): void | Promise<void>;
}

export function createSubagentService(deps: SubagentDependencies) {
  const state: SubagentState = { deps, activity: createSubagentActivity(deps.db, (characterId, subagentId) => deps.changed(characterId, subagentId)), bindings: new Map(), active: new Map(), work: new Set(), closing: false, scheduled: false,
    schedule: () => schedule(state), completionHint: () => undefined, inboxOpportunity: () => undefined };
  restoreGenericRoutes(state);
  const prepareInbox = (input: ForegroundInboxInput & { mode?: "foreground" | "idle" }) => prepareSubagentInbox(state, input,
    (value, sender, continuation) => acceptAddressed(state, value, { sender, continuation }));
  const completion = createSubagentCompletion(state);
  const inboxExecution = createSubagentInboxExecution(state, prepareInbox);
  state.inboxOpportunity = (characterId) => inboxExecution.retry(characterId);
  state.completionHint = () => { completion.hint(); inboxExecution.hint(); };
  const unsubscribe = observeTerminal(state);
  return {
    state,
    prepareInbox,
    activity: state.activity,
    ...readPorts(state),
    yieldInbox: (characterId: string) => inboxExecution.yield(characterId),
    resumeInbox: inboxExecution.resume,
    retryInbox: (input: { characterId: string }) => inboxExecution.retryNow(input.characterId),
    inboxRecovery: (input: Parameters<typeof readSubagentInboxRecovery>[1]) => readSubagentInboxRecovery(deps.db, input),
    attention: (input: Parameters<typeof readSubagentAttention>[1]) => readSubagentAttention(deps.db, input),
    events: createSubagentEventRepo(deps.db), inbox: createSubagentInboxRepo(deps.db),
    delegate: (binding: SubagentWorkBinding, input: DelegateWork, acceptance: SubagentAcceptance = {}) => acceptWork(state, binding, { input, acceptance }),
    submitOwnedWork: (binding: SubagentWorkBinding, input: DelegateWork) => acceptWork(state, binding, { input, acceptance: {} }),
    send: (input: SubagentAddressedInput, sender: SubagentSender) => acceptAddressed(state, input, { sender, continuation: false }),
    sendCurrent: (input: Omit<SubagentAddressedInput, "target"> & { subagentId: string; workInputId?: string | null }, sender: SubagentSender) =>
      acceptCurrentMessage(state, input, sender),
    continue: (input: SubagentAddressedInput, sender: SubagentSender) => acceptAddressed(state, input, { sender, continuation: true }),
    stop: (input: { characterId: string; target: SubagentTarget }, origin: "user" | "parent") => stopChild(state, input, origin),
    yieldOwnedWork: (target: SubagentTarget) => yieldOwned(state, target),
    resumeOwnedWork(binding: SubagentWorkBinding, input: SubagentAddressedInput) {
      const root = deps.inputs.get(input.target.workInputId);
      state.bindings.set(root.inputId, { root, binding, resume: false });
      return acceptAddressed(state, input, { sender: { kind: "core", ownerRef: binding.source?.ownerRef ?? "core.subagent-owner" }, continuation: false });
    },
    released() { state.schedule(); state.completionHint(); },
    async close() {
      state.closing = true;
      unsubscribe(); completion.close(); inboxExecution.close();
      for (const active of state.active.values()) {
        if (active.runId) deps.runs.requestCancel(active.runId, "core shutdown");
        active.controller.abort("core shutdown");
      }
      await Promise.allSettled([...state.work]);
      state.activity.close();
    },
  };
}
export type SubagentService = ReturnType<typeof createSubagentService>;

function acceptCurrentMessage(state: SubagentState,
  input: Omit<SubagentAddressedInput, "target"> & { subagentId: string; workInputId?: string | null }, sender: SubagentSender) {
  let result!: SubagentControlResult;
  state.deps.db.transaction(() => {
    const target = resolveOrdinarySubagentTarget(state, input);
    result = acceptAddressed(state, { ...input, target }, { sender, continuation: false, relaxOrdinaryControl: true });
  });
  return result;
}

function readPorts(state: SubagentState) {
  const { deps } = state;
  return {
    conversation(input: Parameters<typeof readSubagentConversation>[1] & { characterId: string }) {
      assertSubagentCharacter(state, input.characterId, input.subagentId);
      return { conversation: subagentSummary(state, input.subagentId), ...readSubagentConversation(deps.db, input) };
    },
    conversationBody(input: Parameters<typeof readSubagentConversationBody>[1] & { characterId: string }) {
      assertSubagentCharacter(state, input.characterId, input.subagentId);
      return readSubagentConversationBody(deps.db, input);
    },
    activityRead(input: { characterId: string; subagentId: string }) {
      assertSubagentCharacter(state, input.characterId, input.subagentId);
      return state.activity.read(input);
    },
    isWorkCurrent(token: SubagentWorkToken, phase: WorkPhase = "publication"): WorkCurrentness {
      const bound = state.bindings.get(token.workInputId);
      if (!bound || bound.root.subagentId !== token.subagentId) return { state: "unavailable", reason: "source_unavailable" };
      if (phase === "publication" && deps.children.get(token.subagentId).stopOrigin) return { state: "unavailable", reason: "child_stopped" };
      return checkWorkCurrent(state, bound, { token, phase });
    },
    selectMaterials: (characterId: string, refs: Parameters<ReturnType<typeof createMaterialSelection>["select"]>[0]) =>
      createMaterialSelection({ ...deps, characterId }).select(refs),
    list: (input: Parameters<typeof listSubagents>[1]) => listSubagents(state, input),
    history: (input: Parameters<typeof subagentHistory>[1]) => subagentHistory(state, input),
    result: (input: Parameters<typeof subagentResult>[1]) => subagentResult(state, input),
    summary: (subagentId: string) => subagentSummary(state, subagentId),
  };
}

function observeTerminal(state: SubagentState): () => void {
  const { deps } = state;
  return deps.runRepo.onTerminalCommit((fact) => {
    const scope = deps.executions.scope(fact.run.runId);
    const members = deps.db.prepare(`SELECT DISTINCT e.subagent_id FROM subagent_inbox_consumers c
      JOIN subagent_inbox_members m USING(consumer_id) JOIN subagent_events e USING(event_id) WHERE c.run_id=:run`)
      .all({ run: fact.run.runId });
    for (const member of members) deps.changed(fact.run.characterId, String(member.subagent_id));
    if (fact.run.initiator === "primary" && fact.finalOutcome === "completed") state.inboxOpportunity(fact.run.characterId);
    if (scope?.kind === "subagent" && deps.db.prepare("SELECT 1 FROM subagent_events WHERE producer_run_id=:run AND producer_key='terminal' AND eligible=1 LIMIT 1")
      .get({ run: fact.run.runId })) state.inboxOpportunity(fact.run.characterId);
    if (!scope || scope.kind === "agent-inbox") { queueMicrotask(() => state.completionHint()); return; }
    const child = scope.kind === "subagent" ? scope.subagentId : deps.executions.get(scope.completionId).subagentId;
    deps.changed(fact.run.characterId, child);
    queueMicrotask(() => {
      if (state.closing) return;
      if (scope.kind === "subagent") notifyOwner(state, scope.workInputId, { kind: "result", id: fact.run.runId });
      state.schedule(); state.completionHint();
    });
  });
}

function restoreGenericRoutes(state: SubagentState): void {
  const routes = state.deps.db.prepare("SELECT * FROM subagent_work_routes WHERE route_kind='generic'").all();
  for (const route of routes) {
    const root = state.deps.inputs.get(String(route.work_input_id));
    state.bindings.set(root.inputId, { root, resume: false, deferred: "explicit_continuation_required",
      binding: { parentRunId: String(route.parent_run_id), parentToolNames: route.parent_tools_json === null
        ? [] : JSON.parse(String(route.parent_tools_json)) as string[] } });
  }
}

async function acceptWork(state: SubagentState, binding: SubagentWorkBinding, options: { input: DelegateWork; acceptance: SubagentAcceptance }): Promise<SubagentControlResult> {
  const { input, acceptance } = options;
  if (state.closing || acceptance.signal?.aborted) throw new Error("SUBAGENT_ACCEPTANCE_CANCELLED");
  const { deps } = state;
  const parent = deps.runs.status(binding.parentRunId).run;
  if (parent.characterId !== input.characterId || !["running", "waiting"].includes(parent.state)) throw new Error("SUBAGENT_PARENT_UNAVAILABLE");
  let accepted: SubagentInput | undefined;
  let fresh = false;
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
    const acceptance = deps.inputs.accept({ subagentId, operationKey: input.operationKey, sender: { kind: "parent", runId: binding.parentRunId },
      direction: input.direction, materials: input.materials,
      input: { kind: "work", completionPolicy: input.completionPolicy, lifetimeMinutes: input.lifetimeMinutes,
        validity: input.validity, toolSelection: input.toolSelection } });
    accepted = acceptance.input; fresh = !acceptance.reused;
    createSubagentProgressRepo(deps.db).ensure(accepted.inputId, deps.checkInPolicy?.() ?? SUBAGENT_CHECKIN_DEFAULTS, "work_start");
    deps.db.prepare(`INSERT OR IGNORE INTO subagent_work_routes(work_input_id,parent_run_id,route_kind,parent_tools_json)
      VALUES (:work,:parent,:kind,:tools)`).run({ work: accepted.inputId, parent: binding.parentRunId,
      kind: binding.source ? "source_owned" : "generic", tools: binding.parentToolNames ? JSON.stringify(binding.parentToolNames) : null });
  });
  if (!accepted) throw new Error("SUBAGENT_ACCEPTANCE_FAILED");
  const root = accepted;
  if (!state.bindings.has(root.inputId)) state.bindings.set(root.inputId, { root, binding: { ...binding,
    parentToolNames: binding.parentToolNames ? Object.freeze([...binding.parentToolNames]) : undefined }, resume: false });
  try { await acceptance.onAccepted?.(root); }
  catch { deps.reportError("SUBAGENT_REPLY_ACCEPTANCE_UNAVAILABLE"); }
  finally { deps.changed(input.characterId, root.subagentId); state.schedule(); if (fresh) state.inboxOpportunity(input.characterId); }
  return { conversation: subagentSummary(state, root.subagentId), input: root, cancellationRequested: false };
}

function acceptAddressed(state: SubagentState, input: SubagentAddressedInput,
  options: { sender: SubagentSender; continuation: boolean; relaxOrdinaryControl?: boolean }): SubagentControlResult {
  const { sender, continuation } = options;
  if (state.closing) throw new Error("SUBAGENT_CLOSED");
  const { deps } = state;
  assertSubagentCharacter(state, input.characterId, input.target.subagentId);
  const root = deps.inputs.get(input.target.workInputId);
  if (root.subagentId !== input.target.subagentId || root.kind !== "work") throw new Error("SUBAGENT_WORK_MISMATCH");
  let bound = state.bindings.get(root.inputId);
  if (continuation && !bound && sender.kind === "user") {
    const prior = deps.executions.list({ subagentId: root.subagentId, workInputId: root.inputId, limit: 200 });
    if (prior.some((execution) => execution.workToken.source)) throw new Error("SUBAGENT_SOURCE_CONTINUE_REQUIRED");
    bound = { root, binding: { parentRunId: deps.children.get(root.subagentId).createdByRunId }, resume: false };
    state.bindings.set(root.inputId, bound);
  }
  if (continuation && (!bound || workHasUncertainEffects(state, bound))) throw new Error("SUBAGENT_CONTINUE_REQUIRES_RECONCILIATION");
  if (continuation && bound) assertContinuationCurrent(state, bound);
  assertPendingCapacity(state, root.subagentId);
  const policy = deps.checkInPolicy?.() ?? SUBAGENT_CHECKIN_DEFAULTS;
  let acceptance!: ReturnType<typeof deps.inputs.accept>;
  deps.db.transaction(() => {
    createSubagentProgressRepo(deps.db).ensure(root.inputId, policy, "post_upgrade");
    acceptance = deps.inputs.accept({ subagentId: input.target.subagentId, operationKey: input.operationKey,
    sender, direction: input.direction, materials: input.materials, input: continuation
      ? { kind: "continue", workInputId: root.inputId, expectedControlVersion: input.target.expectedControlVersion, expectedRunId: input.target.expectedRunId, replyToEventId: input.replyToEventId }
      : { kind: "message", workInputId: root.inputId, expectedControlVersion: input.target.expectedControlVersion,
        expectedRunId: input.target.expectedRunId, replyToEventId: input.replyToEventId } }, { policy, relaxOrdinaryControl: options.relaxOrdinaryControl });
    acceptDueSubagentCheckIn(deps.db, root.inputId);
  });
  const accepted = acceptance.input;
  if (bound) bound.deferred = undefined;
  notifyOwner(state, root.inputId, { kind: "control", id: root.subagentId });
  deps.db.afterCommit(() => {
    deps.changed(input.characterId, root.subagentId); state.schedule(); state.completionHint();
    if (!acceptance.reused) state.inboxOpportunity(input.characterId);
  });
  return { conversation: subagentSummary(state, root.subagentId), input: accepted, cancellationRequested: false };
}

function assertContinuationCurrent(state: SubagentState, bound: BoundSubagentWork): void {
  const child = state.deps.children.get(bound.root.subagentId);
  const current = checkWorkCurrent(state, bound, { phase: "model_intent", token: { subagentId: child.subagentId,
    workInputId: bound.root.inputId, throughWorkSeq: state.deps.inputs.latestWorkSeq(bound.root.inputId),
    controlVersion: child.controlVersion, source: bound.binding.source } });
  if (current.state !== "current") throw new Error(current.reason === "expired" ? "SUBAGENT_WORK_EXPIRED" : `SUBAGENT_CONTINUE_${current.state.toUpperCase()}`);
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
  state.deps.db.afterCommit(() => state.deps.reports?.closeWork(input.target.workInputId));
  notifyOwner(state, input.target.workInputId, { kind: "control", id: input.target.subagentId });
  return { conversation: subagentSummary(state, input.target.subagentId), input: null, cancellationRequested };
}

function yieldOwned(state: SubagentState, target: SubagentTarget): boolean {
  const child = state.deps.children.get(target.subagentId);
  if (child.controlVersion !== target.expectedControlVersion || child.activeRunId !== target.expectedRunId) throw new Error("SUBAGENT_CONTROL_CONFLICT");
  const active = state.active.get(target.subagentId);
  if (!active || active.workInputId !== target.workInputId || active.controller.signal.aborted) return false;
  active.yielded = true;
  if (active.runId) state.deps.runs.requestCancel(active.runId, "owner_yield");
  active.controller.abort("owner_yield");
  notifyOwner(state, target.workInputId, { kind: "control", id: target.subagentId }); return true;
}

function notifyOwner(state: SubagentState, workInputId: string, input: { kind: "result" | "control"; id: string }): void {
  const { kind, id } = input;
  const binding = state.bindings.get(workInputId)?.binding;
  const callback = kind === "result" ? binding?.onCommittedResult : binding?.onControlChanged;
  if (!callback) return;
  state.deps.db.afterCommit(() => {
    const work = Promise.resolve().then(() => callback(id)).catch(() => state.deps.reportError("SUBAGENT_OWNER_NOTIFICATION_FAILED"))
      .finally(() => state.work.delete(work));
    state.work.add(work);
  });
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
    || (bound.root.workValidity.kind === "expires_at" && Date.now() >= Date.parse(bound.root.workValidity.expiresAt)) || !workNeedsExecution(state, bound)) return;
  if (deps.db.prepare("SELECT event_id FROM subagent_input_waits WHERE work_input_id=:work AND state='open'")
    .get({ work: bound.root.inputId })) return;
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
