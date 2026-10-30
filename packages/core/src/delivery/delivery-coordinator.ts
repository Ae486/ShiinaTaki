/**
 * INPUT: authoritative committed decisions, retained validity and governed presentation bindings
 * OUTPUT: same-Attempt holds/resumes, Run-scoped pending retirement and post-commit Timeline publication
 * POS: core/delivery — no Agent loop; slots, Run state, quota and actual transport outcomes remain distinct
 */
import type { DeliveryRecord, InitiativePresentation } from "@taki/shared";
import type { RunService } from "../harness/run-service.ts";
import type { RunDeliveryRepo, DeliveryPolicy } from "../db/run-delivery-repo.ts";
import type { ConversationStore } from "../agents/conversation-store.ts";
import type { TurnQueue } from "../agents/turn-queue.ts";
import type { TurnRegistry } from "../agents/turn-registry.ts";
import type { TimelineSubscriptions } from "../server/timeline-subscriptions.ts";

export interface DeliveryBinding {
  controller?: AbortController;
  isCurrent(): boolean;
  /** Optional exact-output check. It must synchronously read retained authority without side effects. */
  publicationCurrent?(record: DeliveryRecord): boolean;
  gate(): "ready" | "hold" | "suppress";
  present(presentation: InitiativePresentation): Promise<"completed" | "failed" | "outcome_unknown">;
}
export interface DeliveryCoordinator {
  finish(record: DeliveryRecord, binding: DeliveryBinding): Promise<"settled" | "held">;
  resume(runId: string): Promise<"settled" | "held" | "refused">;
  /** Trusted callers select the exact owned Run; this never infers source authority or retracts committed output. */
  retireRun(runId: string): void;
  retireCharacter(characterId: string): void;
  close(): void;
}
interface DeliveryDeps {
  runs: RunService; repo: RunDeliveryRepo; queue: TurnQueue; turns: TurnRegistry; store: ConversationStore;
  subscriptions: TimelineSubscriptions; policy(): DeliveryPolicy;
  busyMaxWaitMs(): number;
}
interface Held { binding: DeliveryBinding; timer: ReturnType<typeof setTimeout>; until: number }
interface DeliveryState { held: Map<string, Held>; active: Map<string, DeliveryBinding>; closed: boolean }

export function createDeliveryCoordinator(deps: DeliveryDeps): DeliveryCoordinator {
  const state: DeliveryState = { held: new Map(), active: new Map(), closed: false };
  const finish = (record: DeliveryRecord, binding: DeliveryBinding) => finishDelivery(deps, state, { record, binding });
  const expire = (runId: string) => retire(deps, state, runId);
  return {
    finish,
    retireRun: expire,
    async resume(runId) {
      const binding = state.held.get(runId)?.binding; const record = deps.repo.get(runId);
      if (state.closed || !binding || !record) return "refused";
      const release = deps.queue.tryAcquireBackground(record.characterId);
      if (!release) return "held";
      const controller = deps.turns.begin(record.characterId, binding.controller, runId);
      try {
        if (!valid(record, binding) || Date.now() >= (state.held.get(runId)?.until ?? 0)) { expire(runId); return "refused"; }
        if (binding.gate() === "hold") return "held";
        if (record.continuation === "waiting" && !deps.runs.resumeDelivery(runId, record.attemptId, record.version)) {
          expire(runId); return "refused";
        }
        // The busy budget ends at dispatch. Its old timer must never cancel an executing presentation Effect.
        clearTimeout(state.held.get(runId)?.timer);
        return await finish(deps.repo.get(runId) ?? record, binding);
      } finally { deps.turns.end(record.characterId, controller); release(); }
    },
    retireCharacter(characterId) {
      for (const runId of state.held.keys()) if (deps.repo.get(runId)?.characterId === characterId) expire(runId);
    },
    close() { state.closed = true; for (const runId of [...state.held.keys()]) expire(runId); },
  };
}

async function finishDelivery(deps: DeliveryDeps, state: DeliveryState,
  input: { record: DeliveryRecord; binding: DeliveryBinding }): Promise<"settled" | "held"> {
  const record = deps.repo.get(input.record.runId); const { binding } = input;
  // The persisted state is the retirement fence. An old callback cannot restore a held timer, execute a
  // retired presentation or reuse a caller-mutated decision; active bindings only retain cancellation handles.
  if (!record || record.deliveryId !== input.record.deliveryId || record.attemptId !== input.record.attemptId
    || !["staged", "held"].includes(record.state) || state.active.has(record.runId)) return "settled";
  if (state.closed || !valid(record, binding)) { retire(deps, state, record.runId); return "settled"; }
  if (record.decision.outcome === "silent") {
    deps.runs.settle(record.runId, record.attemptId, "completed", { retryable: false }); return "settled";
  }
  if (binding.gate() === "suppress") { retire(deps, state, record.runId); return "settled"; }
  if (binding.gate() === "hold") {
    if (record.continuation === "pending" && !deps.runs.holdDelivery(record.runId, record.attemptId, record.version)) {
      retire(deps, state, record.runId); return "settled";
    }
    if (record.continuation === "none") {
      deps.runs.settle(record.runId, record.attemptId, "completed", { retryable: false });
      deps.repo.transition({ runId: record.runId, expectedVersion: record.version, state: "held", fact: { kind: "delivery.held", state: "held", reasonCode: "busy" } });
    }
    const until = state.held.get(record.runId)?.until ?? Math.min(Date.parse(record.expiresAt),
      record.deliveryClass === "class_b" ? Date.now() + deps.busyMaxWaitMs() : Infinity);
    forget(state, record.runId);
    const timer = setTimeout(() => retire(deps, state, record.runId), Math.max(1, until - Date.now())); timer.unref();
    state.held.set(record.runId, { binding, timer, until }); return "held";
  }
  state.active.set(record.runId, binding);
  try { await deliver(deps, state, { record, binding }); forget(state, record.runId); return "settled"; }
  finally { state.active.delete(record.runId); }
}

function forget(state: DeliveryState, runId: string): void {
  clearTimeout(state.held.get(runId)?.timer); state.held.delete(runId);
}

function valid(record: DeliveryRecord, binding: DeliveryBinding): boolean {
  try { return Date.now() < Date.parse(record.expiresAt) && binding.isCurrent() === true; }
  catch { return false; }
}

async function deliver(deps: DeliveryDeps, state: DeliveryState, input: { record: DeliveryRecord; binding: DeliveryBinding }): Promise<void> {
  const { record, binding } = input;
  let outcome: "completed" | "failed" | "outcome_unknown" = "completed";
  if (record.decision.outcome !== "silent" && record.decision.presentation) {
    if (!valid(record, binding)) { retire(deps, state, record.runId); return; }
    const current = deps.repo.get(record.runId) ?? record;
    if (!["pending", "running"].includes(current.continuation)) { retire(deps, state, record.runId); return; }
    if (current.continuation === "pending") deps.repo.transition({ runId: record.runId, expectedVersion: current.version,
      continuation: "running", fact: { kind: "delivery.resumed", state: "resumed" } });
    try { outcome = await binding.present(record.decision.presentation); } catch { outcome = "outcome_unknown"; }
    const after = deps.repo.get(record.runId);
    if (after) deps.repo.transition({ runId: record.runId, expectedVersion: after.version,
      continuation: outcome === "outcome_unknown" ? "unknown" : outcome,
      fact: { kind: "delivery.presentation_settled", state: outcome === "outcome_unknown" ? "unknown" : outcome, reasonCode: "presentation" } });
  }
  deps.runs.settle(record.runId, record.attemptId, outcome, { retryable: false });
  if (record.decision.outcome !== "speak") return;
  if (!valid(record, binding) || binding.gate() !== "ready") { retire(deps, state, record.runId); return; }
  await publishSpeech(deps, record.runId, binding);
}

async function publishSpeech(deps: DeliveryDeps, runId: string, binding: DeliveryBinding): Promise<void> {
  let entry;
  try { entry = deps.repo.commitPublication({ runId, policy: deps.policy(), append: deps.store.appendDelivery,
    isCurrent: (record) => valid(record, binding) && binding.gate() === "ready"
      && (binding.publicationCurrent === undefined || binding.publicationCurrent(record) === true) }); }
  catch (error) {
    const reasonCode = publicationRefusal(error);
    // A write/observer failure is not a policy denial; preserve its transaction outcome for the owner/recovery path.
    if (!reasonCode) throw error;
    const record = deps.repo.get(runId);
    const state = reasonCode === "expired" ? "expired" : "suppressed";
    if (record) deps.repo.transition({ runId, expectedVersion: record.version, state, fact: {
      kind: state === "expired" ? "delivery.expired" : "delivery.suppressed", state, reasonCode } });
    return;
  }
  if (!entry) return;
  // The canonical row and budget have committed. Any exception from here is uncertainty, never a refund.
  let outcome: "sent" | "unknown" | "no_target";
  try { outcome = await deps.subscriptions.publishObserved(entry); } catch { outcome = "unknown"; }
  const record = deps.repo.get(runId);
  if (record) deps.repo.transition({ runId, expectedVersion: record.version, state: outcome,
    fact: { kind: outcome === "sent" ? "delivery.sent" : outcome === "no_target" ? "delivery.no_target" : "delivery.unknown", state: outcome, reasonCode: "transport" } });
}

function publicationRefusal(error: unknown): "gap" | "budget" | "expired" | "stale" | undefined {
  if (!(error instanceof Error)) return undefined;
  switch (error.message) {
    case "DELIVERY_GAP": return "gap";
    case "DELIVERY_BUDGET": return "budget";
    case "DELIVERY_EXPIRED": return "expired";
    case "DELIVERY_RUN_REFUSED": return "stale";
    case "DELIVERY_SOURCE_REFUSED": return "stale";
    default: return undefined;
  }
}

function retire(deps: DeliveryDeps, state: DeliveryState, runId: string): void {
  const record = deps.repo.get(runId);
  if (!record || !["staged", "held"].includes(record.state)) { forget(state, runId); return; }
  const running = record.continuation === "running";
  const retired = deps.repo.transition({ runId, expectedVersion: record.version, state: "expired",
    continuation: running ? "running" : record.continuation === "none" ? "none" : "expired",
    fact: { kind: "delivery.expired", state: "expired", reasonCode: "expired" } });
  if (!retired) return;
  // Commit retirement before discarding its only live bindings. A persistence refusal must remain retryable.
  const binding = state.active.get(runId) ?? state.held.get(runId)?.binding;
  forget(state, runId);
  const status = deps.runs.status(runId);
  if (status.run.activeAttemptId !== record.attemptId || !["running", "waiting", "cancel_requested"].includes(status.run.state)) return;
  deps.runs.requestCancel(runId, "delivery retired");
  deps.turns.cancel(record.characterId, runId);
  binding?.controller?.abort("delivery retired");
  // Cancellation is not proof that an already dispatched presentation stopped. Its actual settlement (or
  // existing restart recovery) owns the terminal outcome, including uncertainty and the Effect's evidence.
  if (!running) deps.runs.settle(runId, record.attemptId, "cancelled", { retryable: false });
}
