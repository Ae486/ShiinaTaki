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

type PrepareInbox = (input: ForegroundInboxInput & { mode: "idle" }) => (ForegroundInboxContext & { consumerId: string }) | undefined;
interface ActiveInbox { controller: AbortController; yieldRequested: boolean; runId?: string; retryRequested?: boolean }

export function createSubagentInboxExecution(state: SubagentState, prepare: PrepareInbox) {
  const active = new Map<string, ActiveInbox>(); const refused = new Set<string>(); let scheduled = false;
  const inbox = createSubagentInboxRepo(state.deps.db);
  const hint = () => {
    if (state.closing || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (state.closing) return;
      for (const characterId of inbox.readyCharacters()) {
        if (active.has(characterId) || refused.has(characterId)) continue;
        const release = state.deps.queue.tryAcquireBackground(characterId);
        if (!release) continue;
        const current: ActiveInbox = { controller: new AbortController(), yieldRequested: false };
        active.set(characterId, current);
        const work = executeInbox(state, { characterId, current, prepare }).catch(() => {
          const delivered = current.runId && state.deps.db.prepare(`SELECT 1 FROM subagent_inbox_consumers c
            JOIN subagent_inbox_deliveries d USING(consumer_id) WHERE c.run_id=:run LIMIT 1`).get({ run: current.runId });
          // Durable delivery already fences those members. Only a pre-intent failure defers automatic recapture.
          if (!delivered && !current.retryRequested) refused.add(characterId);
          state.deps.reportError("SUBAGENT_INBOX_EXECUTION_UNAVAILABLE");
        }).finally(() => {
          active.delete(characterId); state.work.delete(work); release();
          if (!refused.has(characterId)) hint();
        });
        state.work.add(work);
      }
    });
  };
  return { hint, resume: (input: InboxResumeInput) => resumeInbox(state, input, { active, prepare, hint }), retry(characterId?: string) {
    for (const id of characterId ? [characterId] : new Set([...refused, ...active.keys()])) {
      refused.delete(id);
      const current = active.get(id);
      if (current) current.retryRequested = true;
    }
    hint();
  }, yield(characterId: string) {
    const current = active.get(characterId); if (current) current.yieldRequested = true;
  }, close() { for (const current of active.values()) current.controller.abort("core shutdown"); } };
}

async function resumeInbox(state: SubagentState, input: InboxResumeInput,
  ports: { active: Map<string, ActiveInbox>; prepare: PrepareInbox; hint(): void }) {
  const previous = state.deps.db.prepare(`SELECT c.* FROM subagent_inbox_resumes r JOIN subagent_inbox_consumers c USING(consumer_id)
    WHERE r.previous_consumer_id=:id AND r.operation_key=:key AND c.character_id=:character`)
    .get({ id: input.consumerId, key: input.operationKey, character: input.characterId });
  if (previous) return { runId: String(previous.run_id), consumerId: String(previous.consumer_id), reused: true, state: String(previous.state) };
  if (state.closing) throw new Error("SUBAGENT_CLOSED");
  assertSubagentInboxResumable(state.deps.db, input);
  const release = state.deps.queue.tryAcquireBackground(input.characterId);
  if (!release) throw new Error("SUBAGENT_INBOX_BUSY");
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
      } } });
    const work = executeInbox(state, { characterId: input.characterId, current, prepare: ports.prepare, admission })
      .catch(() => state.deps.reportError("SUBAGENT_INBOX_EXECUTION_UNAVAILABLE")).finally(() => {
        ports.active.delete(input.characterId); state.work.delete(work); release(); ports.hint();
      });
    state.work.add(work);
    return { runId: admission.run.runId, consumerId, reused: admission.reused, state: "claimed" };
  } catch (error) { ports.active.delete(input.characterId); release(); throw error; }
}

async function executeInbox(state: SubagentState, input: { characterId: string; current: ActiveInbox; prepare: PrepareInbox; admission?: RunAdmissionResult }): Promise<void> {
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
}

function inboxWorkContext(state: SubagentState, input: { consumer: ForegroundInboxContext & { consumerId: string };
  turn: TurnContext; characterId: string; current: ActiveInbox }): WorkContext {
  const { consumer, turn } = input;
  const runId = turn.runId;
  if (!runId) throw new Error("SUBAGENT_INBOX_RUN_MISMATCH");
  return {
    scope: { kind: "agent-inbox", consumerId: consumer.consumerId },
    instructions: "You are the main Companion handling private worker events. Plain text is retained privately in this handler. "
      + "Store speech_proposed only for an intended final delayed answer; it remains subject to separate publication authority.\n" + consumer.instructions,
    tools: { ...state.deps.mainTools?.(input.characterId, turn), ...consumer.tools }, selectTools: (tools) => tools,
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
    recordCompletedStep: consumer.recordCompletedStep,
    recordPartial(partial) {
      if (partial.text) state.deps.messages.stageTerminal({ runId, attemptId: partial.attemptId,
        batch: { stepNumber: partial.stepNumber, entryKind: "partial", messages: [{ role: "assistant", content: partial.text }] } });
    },
    stop: () => input.current.yieldRequested || !createSubagentInboxRepo(state.deps.db).get(consumer.consumerId).events.some((event) => event.state !== "handled"),
  };
}
