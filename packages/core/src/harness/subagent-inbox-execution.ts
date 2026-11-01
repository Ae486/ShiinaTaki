/**
 * INPUT: bounded eligible inbox and the existing Character background lane
 * OUTPUT: private main-Agent handling with actual delivery receipts and cooperative foreground yield
 * POS: core/harness — one normal Run/Attempt per consumer; no child impersonation or new model executor
 */
import { randomUUID } from "node:crypto";
import type { ForegroundInboxInput, ForegroundInboxContext } from "../agents/foreground-inbox.ts";
import type { TurnContext } from "../agents/chat-agent.ts";
import type { WorkContext } from "../agents/work-context.ts";
import { createSubagentInboxRepo } from "../db/subagent-inbox-repo.ts";
import type { SubagentState } from "./subagent-state.ts";
import type { RunAdmissionResult } from "../db/run-repo.ts";
import { assertSubagentInboxResumable } from "../db/subagent-inbox-recovery-repo.ts";
import type { SubagentInboxResumeParams as InboxResumeInput } from "@taki/shared";

import { createSubagentInboxRetry } from "./subagent-inbox-retry.ts";
import { recordInboxRetryFailure, clearInboxRetryFailure, readInboxRetryFailures } from "../db/subagent-inbox-retry-repo.ts";
import { createInboxYieldContinuations, createInboxYieldWitness, type InboxYieldAdmission, type InboxYieldCertificate, type InboxYieldWitness } from "./subagent-inbox-yield.ts";

type PrepareInbox = (input: ForegroundInboxInput & { mode: "idle" }) => (ForegroundInboxContext & { consumerId: string }) | undefined;
interface ActiveInbox { controller: AbortController; yieldRequested: boolean; runId?: string; retryRequested?: boolean; yieldWitness?: InboxYieldWitness }

export function createSubagentInboxExecution(state: SubagentState, prepare: PrepareInbox) {
  const active = new Map<string, ActiveInbox>();
  const refused = new Set(readInboxRetryFailures(state.deps.db));
  let scheduled = false;
  const retries = createSubagentInboxRetry((id) => { if (!state.closing) { refused.delete(id); hint(); } });
  const inbox = createSubagentInboxRepo(state.deps.db);
  const continuations = createInboxYieldContinuations(state, { isActive: (id) => active.has(id),
    hint: () => hint(), resume: (input, yieldAdmission) => resumeInbox(state, input,
      { active, prepare, hint, rememberYield: continuations.remember, yieldAdmission }) });
  const hint = () => {
    if (state.closing || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (state.closing) return;
      continuations.advance();
      startReadyInbox(state, { active, refused, retries, prepare, hint, rememberYield: continuations.remember });
    });
  };
  const retry = (characterId?: string) => retryInboxOpportunity(state, { characterId, active, refused, retries, hint });
  return { hint, resume: (input: InboxResumeInput) => resumeInbox(state, input, { active, prepare, hint,
    rememberYield: continuations.remember, onCapture: () => continuations.forget(input.consumerId) }), retry,
    retryNow(characterId: string) {
      if (state.closing || !inbox.readyCharacters().includes(characterId)) return { status: "not_needed" as const };
      retry(characterId); notifyRetryAttention(state, characterId); return { status: "scheduled" as const };
    }, yield(characterId: string) {
    const current = active.get(characterId); if (current) current.yieldRequested = true;
  }, close() {
    retries.close();
    continuations.close();
    for (const current of active.values()) current.controller.abort("core shutdown");
  } };
}

function startReadyInbox(state: SubagentState, ports: {
  active: Map<string, ActiveInbox>; refused: Set<string>; retries: ReturnType<typeof createSubagentInboxRetry>;
  prepare: PrepareInbox; hint(): void; rememberYield(certificate: InboxYieldCertificate | undefined): void;
}): void {
  for (const characterId of createSubagentInboxRepo(state.deps.db).readyCharacters()) {
    if (ports.active.has(characterId) || ports.refused.has(characterId)) continue;
    const release = state.deps.queue.tryAcquireBackground(characterId);
    if (!release) continue;
    const current: ActiveInbox = { controller: new AbortController(), yieldRequested: false };
    ports.active.set(characterId, current);
    const work = executeInbox(state, { characterId, current, prepare: ports.prepare }).then((certificate) => {
      ports.rememberYield(certificate);
      ports.retries.reset(characterId); clearInboxRetryFailure(state.deps.db, characterId);
    }).catch(() => {
      deferInboxFailure(state, { characterId, current }, ports);
    }).finally(() => {
      ports.active.delete(characterId); state.work.delete(work); release(); state.schedule();
      if (!ports.refused.has(characterId)) ports.hint();
    });
    state.work.add(work);
  }
}

function retryInboxOpportunity(state: SubagentState, input: {
  characterId?: string; active: Map<string, ActiveInbox>; refused: Set<string>;
  retries: ReturnType<typeof createSubagentInboxRetry>; hint(): void;
}): void {
  for (const id of input.characterId ? [input.characterId] : new Set([...input.refused, ...input.active.keys()])) {
    input.refused.delete(id);
    input.retries.reset(id);
    clearInboxRetryFailure(state.deps.db, id);
    const current = input.active.get(id);
    if (current) current.retryRequested = true;
  }
  input.hint();
}

function deferInboxFailure(state: SubagentState, input: { characterId: string; current: ActiveInbox },
  ports: { refused: Set<string>; retries: ReturnType<typeof createSubagentInboxRetry> }): void {
  if (state.closing) return;
  const { current, characterId } = input;
  const delivered = current.runId && state.deps.db.prepare(`SELECT 1 FROM subagent_inbox_consumers c
    JOIN subagent_inbox_deliveries d USING(consumer_id) WHERE c.run_id=:run LIMIT 1`).get({ run: current.runId });
  // Only a proven pre-intent failure can make the original event eligible for another automatic capture.
  if (!delivered && !current.retryRequested) {
    ports.refused.add(characterId);
    const effect = current.runId && state.deps.db.prepare("SELECT 1 FROM run_effects WHERE run_id=:run LIMIT 1").get({ run: current.runId });
    if (!effect && !ports.retries.arm(characterId)) {
      recordInboxRetryFailure(state.deps.db, characterId);
      notifyRetryAttention(state, characterId);
    }
  }
  state.deps.reportError("SUBAGENT_INBOX_EXECUTION_UNAVAILABLE");
}

function notifyRetryAttention(state: SubagentState, characterId: string): void {
  const rows = state.deps.db.prepare("SELECT DISTINCT subagent_id FROM subagent_events WHERE character_id=:character AND eligible=1")
    .all({ character: characterId });
  for (const row of rows) state.deps.changed(characterId, String(row.subagent_id));
}

async function resumeInbox(state: SubagentState, input: InboxResumeInput,
  ports: { active: Map<string, ActiveInbox>; prepare: PrepareInbox; hint(): void;
    rememberYield(certificate: InboxYieldCertificate | undefined): void; yieldAdmission?: InboxYieldAdmission; onCapture?(): void }) {
  const previous = state.deps.db.prepare(`SELECT c.* FROM subagent_inbox_resumes r JOIN subagent_inbox_consumers c USING(consumer_id)
    WHERE r.previous_consumer_id=:id AND r.operation_key=:key AND c.character_id=:character`)
    .get({ id: input.consumerId, key: input.operationKey, character: input.characterId });
  if (previous) return { runId: String(previous.run_id), consumerId: String(previous.consumer_id), reused: true, state: String(previous.state) };
  if (state.closing) throw new Error("SUBAGENT_CLOSED");
  assertSubagentInboxResumable(state.deps.db, input);
  const release = state.deps.queue.tryAcquireBackground(input.characterId);
  if (!release) throw new Error("SUBAGENT_INBOX_BUSY");
  ports.onCapture?.();
  const current: ActiveInbox = { controller: new AbortController(), yieldRequested: false };
  ports.active.set(input.characterId, current);
  try {
    const consumerId = randomUUID();
    const admission = await state.deps.runs.admitLinked({ triggerRequestId: randomUUID(),
      idempotencyKey: `inbox-resume:${input.consumerId}:${input.operationKey}`, characterId: input.characterId,
      initiator: "subagent", deliveryClass: "internal", contextMode: "autonomous", provenance: { provider: "core.subagent-inbox" } },
    { signal: current.controller.signal, linked: { kind: "agent-inbox", consumerId, resumesConsumerId: input.consumerId,
      operationKey: input.operationKey, validateTx() {
        if (state.closing || current.controller.signal.aborted) throw new Error("SUBAGENT_CLOSED");
        ports.yieldAdmission?.validateTx();
      } } });
    const work = executeInbox(state, { characterId: input.characterId, current, prepare: ports.prepare, admission })
      .then(ports.rememberYield)
      .catch(() => state.deps.reportError("SUBAGENT_INBOX_EXECUTION_UNAVAILABLE")).finally(() => {
        ports.active.delete(input.characterId); state.work.delete(work); release(); state.schedule(); ports.hint();
      });
    state.work.add(work);
    return { runId: admission.run.runId, consumerId, reused: admission.reused, state: "claimed" };
  } catch (error) { ports.active.delete(input.characterId); release(); throw error; }
}

async function executeInbox(state: SubagentState, input: { characterId: string; current: ActiveInbox; prepare: PrepareInbox; admission?: RunAdmissionResult }): Promise<InboxYieldCertificate | undefined> {
  const { deps } = state; const { current, characterId } = input;
  const admission = input.admission ?? await deps.runs.admit({ triggerRequestId: randomUUID(), idempotencyKey: `agent-inbox:${randomUUID()}`,
    characterId, initiator: "subagent", deliveryClass: "internal", contextMode: "autonomous", provenance: { provider: "core.subagent-inbox" } });
  current.runId = admission.run.runId;
  if (admission.reused || !deps.runs.start(admission.run.runId, admission.attempt.attemptId)) return;
  const runId = admission.run.runId; const attemptId = admission.attempt.attemptId;
  const turn: TurnContext = { runId, attemptId, turnKind: "non-primary", signal: current.controller.signal,
    runContext: deps.runs.context(runId) };
  let failed = false; let consumer: ReturnType<PrepareInbox>;
  try {
    consumer = input.prepare({ characterId, runId, attemptId, mode: "idle", actualInvocation: () => turn.toolObserver?.currentInvocation?.() });
    if (!consumer) return;
    turn.workContext = inboxWorkContext(state, { consumer, turn, characterId, current });
    deps.turns.begin(characterId, current.controller, runId);
    for await (const delta of deps.agent.stream({ characterId, message: "Handle the delivered private worker events." }, turn)) { void delta; }
  } catch (error) { failed = true; throw error; }
  finally {
    consumer?.dispose();
    if (current.controller.signal.aborted) deps.runs.requestCancel(runId, "inbox cancelled");
    const run = deps.runs.status(runId).run;
    if (["running", "waiting", "cancel_requested"].includes(run.state)) deps.runs.settle(runId, attemptId,
      current.controller.signal.aborted ? "cancelled" : failed ? "failed" : "completed", { retryable: false });
    deps.turns.end(characterId, current.controller);
  }
  return current.yieldWitness?.certify();
}

function inboxWorkContext(state: SubagentState, input: { consumer: ForegroundInboxContext & { consumerId: string };
  turn: TurnContext; characterId: string; current: ActiveInbox }): WorkContext {
  const { consumer, turn } = input;
  const runId = turn.runId;
  if (!runId) throw new Error("SUBAGENT_INBOX_RUN_MISMATCH");
  const witness = createInboxYieldWitness(state, { characterId: input.characterId, consumerId: consumer.consumerId,
    runId, attemptId: turn.attemptId!, signal: input.current.controller.signal, requested: () => input.current.yieldRequested });
  input.current.yieldWitness = witness;
  return {
    scope: { kind: "agent-inbox", consumerId: consumer.consumerId },
    instructions: "You are the main Companion handling private worker events. Review relevant delivered reports/questions now; read exact detail when a preview is incomplete and use the supplied exact event and target for supported actions. Plain text is retained privately in this handler. "
      + "This unattended inbox opportunity cannot create children. You may inspect, answer, explicitly continue a permitted check-in, retain, or stop existing children. "
      + "This batch contains only newly delivered events; earlier handlers and their retained reports are not included. If synthesis needs another worker's report absent from your context, inspect its retained results once before treating it as pending. If required reports are still unavailable, retain the available evidence and end this handler; later inbox events let you finish without another user message. Do not poll for completion. "
      + "When the available results fulfill a user request still awaiting its answer, use handle_agent_event with speech_proposed and put the complete integrated user-facing final answer in note. This asks Core to validate and arrange delivery under the original request's publication authority. "
      + "Plain text, retained and no_action remain internal and do not deliver that answer. An accepted proposal is not proof of publication. Do not repeat an already delivered answer or publish every progress update; retain events that need no user-facing response.\n" + consumer.instructions,
    tools: Object.fromEntries(Object.entries({ ...state.deps.mainTools?.(input.characterId, turn), ...consumer.tools })
      .filter(([name]) => name !== "delegate_subagent")),
    selectTools: (tools) => Object.fromEntries(Object.entries(tools).filter(([name]) => name !== "delegate_subagent")),
    project: () => {
      const projection = state.deps.store.project(input.characterId);
      return { ...projection, messages: [...projection.messages, { role: "user" as const,
        content: "[Core runtime control; not a user utterance] Handle the private worker inbox supplied in the instructions." }] };
    },
    prepareStep: (step) => ({ ...step, inputIds: [] }),
    commitModelInput(step, effect) {
      if (state.deps.runs.context(runId)?.authorityCurrent?.() !== true || input.current.controller.signal.aborted) throw new Error("SUBAGENT_AUTHORITY_UNAVAILABLE");
      consumer.commitModelIntent(effect, step.stepNumber);
    },
    recordCompletedStep(step) { consumer.recordCompletedStep(step); witness.record(step); },
    recordPartial(partial) {
      if (partial.text) state.deps.messages.stageTerminal({ runId, attemptId: partial.attemptId,
        batch: { stepNumber: partial.stepNumber, entryKind: "partial", messages: [{ role: "assistant", content: partial.text }] } });
    },
    stop: (options) => witness.stop(options,
      createSubagentInboxRepo(state.deps.db).get(consumer.consumerId).events.some((event) => event.state !== "handled")),
  };
}
