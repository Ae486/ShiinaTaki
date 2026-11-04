/**
 * INPUT: real source invalidations, accepted Pattern authority and C1 execution ports
 * OUTPUT: one bounded deterministic pending candidate and the existing InitiativeRuntime dispatch
 * POS: core/initiative/wake — source adapter only; no Agent loop, lane, ledger or quota writer
 */
import type { InitiativeWakeReason, InitiativeWakePolicyStatus } from "@taki/shared";
import type { InitiativeWakeDependencies, WakeCandidate, WakeSelection } from "./wake-contract.ts";
import { deterministicChance, wakeDigest } from "./wake-matcher.ts";
import { matchWakeSources } from "./wake-candidates.ts";
import { createWakePolicyRepo, type WakePolicyRepo } from "./wake-policy-repo.ts";
import { commonWakeRefusal, selectionCurrent, wakeDeliveryGate } from "./wake-eligibility.ts";
import { hasIntentionSource, claimIntentionSelection, linkIntentionSelection, settleIntentionSelection } from "./wake-intention-lifecycle.ts";

export interface InitiativeWakeEngine {
  start(): void;
  notify(reason?: "source" | "policy" | "release"): void;
  evaluate(): Promise<void>;
  read(characterId: string): InitiativeWakePolicyStatus;
  close(): Promise<void>;
}
interface EngineState {
  deps: InitiativeWakeDependencies; repo: WakePolicyRepo; now(): number;
  closed: boolean; started: boolean; active?: Promise<void>; pending?: WakeSelection; pendingUntil?: number;
  retained?: WakeSelection; retainedRunId?: string; timer?: ReturnType<typeof setTimeout>;
}

export function createInitiativeWakeEngine(deps: InitiativeWakeDependencies): InitiativeWakeEngine {
  const now = deps.now ?? Date.now;
  const state: EngineState = { deps, repo: createWakePolicyRepo(deps.db, now), now, closed: false, started: false };
  state.repo.reconcile();
  const evaluate = () => {
    if (state.closed) return Promise.resolve();
    if (state.active) return state.active;
    const operation = runEvaluation(state).catch((error: unknown) => reportError(state, error));
    state.active = operation;
    void operation.finally(() => {
      state.active = undefined;
      try { arm(state, evaluate); } catch (error) { reportError(state, error); }
    });
    return operation;
  };
  return {
    start() { if (state.started || state.closed) return; state.started = true; arm(state, evaluate); },
    notify(reason = "source") {
      invalidateRetained(state);
      if (state.closed || !state.started || (reason === "source" && !deps.wakePolicy().eventsEnabled)) return;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => { state.timer = undefined; void evaluate(); }, 0); state.timer.unref();
    },
    evaluate,
    read: state.repo.read,
    async close() {
      state.closed = true; if (state.timer) clearTimeout(state.timer);
      retirePending(state);
      if (state.retained) deps.invalidate?.(state.retained.characterId);
      await state.active;
    },
  };
}

function arm(state: EngineState, evaluate: () => Promise<void>): void {
  if (state.closed || !state.started || state.timer) return;
  const policy = state.deps.wakePolicy();
  const snapshot = state.deps.snapshot(); const target = snapshot.targetId;
  const dueAt = snapshot.enabled && policy.eventsEnabled && target ? state.deps.intentions?.nextWakeAt(target) : undefined;
  if (!policy.periodicEnabled && !state.pending && dueAt === undefined) return;
  const dueWait = dueAt === undefined ? Infinity : dueAt <= state.now() ? policy.checkIntervalMs : Math.max(1, dueAt - state.now());
  const ordinaryWait = state.pending ? Math.min(policy.checkIntervalMs,
    Math.max(1, (state.pendingUntil ?? state.pending.expiresAt) - state.now())) : policy.periodicEnabled ? policy.checkIntervalMs : Infinity;
  const wait = Math.min(ordinaryWait, dueWait, 2_147_483_647);
  state.timer = setTimeout(() => { state.timer = undefined; void evaluate(); }, wait); state.timer.unref();
}

async function runEvaluation(state: EngineState): Promise<void> {
  invalidateRetained(state);
  if (await resumeRetained(state)) return;
  const snapshot = state.deps.snapshot();
  const characterId = snapshot.targetId;
  if (!characterId) return;
  const refusal = commonWakeRefusal(state.deps, snapshot, state.now());
  if (refusal) { retirePending(state); note(state, characterId, { reason: refusal }); return; }
  if (state.pending && ((state.pendingUntil ?? state.pending.expiresAt) <= state.now()
    || !selectionCurrent(state.deps, state.pending, state.now()))) {
    retirePending(state); note(state, characterId, { reason: "expired" }); return;
  }
  const selection = state.pending ?? selectOpportunity(state, snapshot);
  if (!selection) return;
  if (state.deps.busy(characterId)) {
    state.pending = selection;
    state.pendingUntil ??= Math.min(selection.expiresAt, state.now() + state.deps.policy().busyMaxWaitMs);
    note(state, characterId, { reason: "busy", candidates: selection.candidates }); return;
  }
  state.pending = undefined; state.pendingUntil = undefined;
  if (!hasIntentionSource(selection) && !state.repo.claim(selection)) {
    note(state, characterId, { reason: "duplicate", candidates: selection.candidates }); return;
  }
  state.retained = selection; state.retainedRunId = undefined;
  await dispatchSelection(state, selection);
}

async function resumeRetained(state: EngineState): Promise<boolean> {
  const selection = state.retained; const runId = state.retainedRunId;
  if (!selection || !runId) return false;
  if (state.deps.busy(selection.characterId)) return true;
  const status = await state.deps.runtime.resume(runId);
  if (status !== "held") {
    settleIntentionSelection(state.deps, state.repo, selection);
    state.retained = undefined; state.retainedRunId = undefined;
  }
  return true;
}

function selectOpportunity(state: EngineState, snapshot: WakeSelection["snapshot"]): WakeSelection | undefined {
  const characterId = snapshot.targetId;
  if (!characterId) return;
  const matched = matchWakeSources(state.deps.patterns.listActive(characterId), snapshot, state.now());
  let refused = matched.reason;
  const eligible = matched.candidates.filter((candidate) => {
    const refusal = candidateRefusal(state, candidate);
    if (refusal) { refused = refusal; return false; }
    return true;
  });
  const first = eligible[0];
  if (!first) { note(state, characterId, { reason: refused }); return; }
  const candidates = eligible.filter((candidate) => candidate.sourceKey === first.sourceKey).slice(0, 4);
  const capturedAt = state.now();
  return { opportunityId: wakeDigest(first.sourceKey), sourceKey: first.sourceKey, characterId, capturedAt,
    expiresAt: Math.min(capturedAt + state.deps.policy().outputTtlMs, ...candidates.map((candidate) => candidate.expiresAt)),
    snapshot: structuredClone(snapshot), candidates };
}

function candidateRefusal(state: EngineState, candidate: WakeCandidate): InitiativeWakeReason | undefined {
  if (state.repo.claimed(candidate.sourceKey)) return "duplicate";
  if (candidate.kind !== "pattern") return undefined;
  const last = state.repo.lastPatternJudgment(candidate.patternId);
  if (last !== undefined && state.now() - last < candidate.definition.timing.minimumGapMinutes * 60_000) return "pattern-cooldown";
  if (deterministicChance(candidate.candidateId) >= candidate.definition.timing.chance) return "chance";
  return undefined;
}

async function dispatchSelection(state: EngineState, selection: WakeSelection): Promise<void> {
  try {
    const context = await state.deps.prepareContext(selection);
    if (!context) { note(state, selection.characterId, { reason: "context-unavailable", candidates: selection.candidates }); return; }
    if (state.closed || !selectionCurrent(state.deps, selection, state.now())) {
      note(state, selection.characterId, { reason: "stale-policy", candidates: selection.candidates }); return;
    }
    const refusal = commonWakeRefusal(state.deps, state.deps.snapshot(), state.now());
    if (refusal) { note(state, selection.characterId, { reason: refusal, candidates: selection.candidates }); return; }
    if (hasIntentionSource(selection) && !claimIntentionSelection(state.deps, state.repo, selection)) {
      note(state, selection.characterId, { reason: "dispatch-refused", candidates: selection.candidates }); return;
    }
    const result = await state.deps.runtime.dispatch({ opportunityId: selection.opportunityId, characterId: selection.characterId,
      selectedContext: context,
      ...(state.deps.prepareInput
        ? { prepareInput: (turn) => state.deps.prepareInput!(selection, turn) } : {}),
      isCurrent: () => !state.closed && selectionCurrent(state.deps, selection, state.now()),
      deliveryGate: () => wakeDeliveryGate(state.deps, selection, state.now()),
      beforeAdmit: () => {
        const reason = state.deps.backoff?.refusal(selection.characterId);
        return reason === "backoff-daily" ? "budget" : reason === "backoff-spacing" ? "gap" : undefined;
      },
      onAdmitted: ({ runId, attemptId }) => {
        state.deps.backoff?.recordAdmission(runId, selection.snapshot.timezone);
        state.repo.settle(selection.opportunityId, runId);
        return linkIntentionSelection(state.deps, selection, runId)
          && state.deps.sourceAdmitted?.(selection, { runId, attemptId }) !== false;
      } });
    if (result.runId) state.repo.settle(selection.opportunityId, result.runId);
    state.retainedRunId = result.status === "held" ? result.runId : undefined;
    note(state, selection.characterId, { reason: result.runId ? "admitted" : "dispatch-refused", candidates: selection.candidates });
  } finally {
    settleIntentionSelection(state.deps, state.repo, selection);
    if (!state.retainedRunId) state.retained = undefined;
  }
}

function invalidateRetained(state: EngineState): void {
  const selection = state.retained;
  if (selection && !selectionCurrent(state.deps, selection, state.now())) {
    state.deps.invalidate?.(selection.characterId); state.retained = undefined; state.retainedRunId = undefined;
  }
}
function retirePending(state: EngineState): void {
  // Pending busy work is not a persistent execution queue. Tombstone its occurrence at the original deadline.
  const pending = state.pending; state.pending = undefined; state.pendingUntil = undefined;
  if (pending && !hasIntentionSource(pending) && pending.expiresAt > pending.capturedAt && state.repo.claim(pending)) state.repo.settle(pending.opportunityId);
}
function note(state: EngineState, characterId: string, input: { reason: InitiativeWakeReason; candidates?: WakeCandidate[] }): void {
  const { reason, candidates = [] } = input;
  if (!state.repo.note(characterId, { reason, occurredAt: new Date(state.now()).toISOString(),
    matchedCount: candidates.length, source: candidates[0]?.source ?? "none" })) return;
  try {
    const observed = state.deps.onChanged?.(characterId);
    if (observed) void observed.catch((error: unknown) => observeFailure(state, error));
  } catch (error) { observeFailure(state, error); }
}
function reportError(state: EngineState, error: unknown): void {
  observeFailure(state, error);
  try {
    const characterId = state.deps.snapshot().targetId;
    if (characterId) note(state, characterId, { reason: "source-error" });
  } catch (failure) { observeFailure(state, failure); }
}
function observeFailure(state: EngineState, error: unknown): void {
  // A diagnostic observer, including its error reporter, has no authority over admission.
  try { state.deps.onError?.(error); } catch { return; }
}
