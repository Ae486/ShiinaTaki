/**
 * INPUT: accepted same-source reports with explicit uninterrupted trusted-input tracking
 * OUTPUT: bounded source-local return facts after ten minutes of evidenced inactivity
 * POS: core/presence — no global absence inference, lease backfill, sensor or wake dispatch
 */
import { randomUUID } from "node:crypto";
import type { InitiativePresenceReturn, PresenceReportParams } from "@taki/shared";
import type { PresenceSource } from "./presence-sources.ts";
import { PRESENCE_INPUT_FRESH_MS } from "./presence-policy.ts";

const KNOWN_INACTIVE_MS = 600000;
interface ReturnState {
  key: string; generation: number; coveredUntil: number; observedAt: number;
  inputAt: number | null; sequence: number; age: number; kind: string | null;
  inactiveSince: number | null; tracked: boolean; visible: boolean;
  returned?: InitiativePresenceReturn;
}

export function createPresenceReturnTracker(onChange?: () => void) {
  const states = new WeakMap<PresenceSource, ReturnState>();
  const notify = () => {
    try { onChange?.(); }
    catch { /* An optional observer cannot alter accepted source truth. */ }
  };
  return {
    observe(source: PresenceSource, report: PresenceReportParams, at: number) {
      const state = states.get(source) ?? initialState();
      const oldReturn = state.returned;
      const previousVisibility = state.visible;
      observeReturn(state, { source, report, at });
      states.set(source, state);
      if (state.returned !== oldReturn || (state.returned && previousVisibility !== source.visible)) notify();
    },
    retire(source: PresenceSource) {
      const state = states.get(source);
      if (!state) return;
      const hadReturn = state.returned !== undefined;
      resetContinuity(state);
      if (hadReturn) notify();
    },
    recent(sources: readonly PresenceSource[], at: number): InitiativePresenceReturn | undefined {
      let latest: InitiativePresenceReturn | undefined;
      for (const source of sources) {
        const state = states.get(source);
        const fact = state?.returned;
        if (!state?.tracked || !fact || at >= state.coveredUntil || at < fact.observedAt
          || at - fact.inputAt >= PRESENCE_INPUT_FRESH_MS) continue;
        if (!latest || fact.inputAt > latest.inputAt) latest = fact;
      }
      return latest && { ...latest };
    },
  };
}

function initialState(): ReturnState {
  return { key: randomUUID(), generation: 0, coveredUntil: 0, observedAt: 0,
    inputAt: null, sequence: 0, age: 0, kind: null, inactiveSince: null, tracked: false, visible: false };
}

function resetContinuity(state: ReturnState): void {
  if (state.tracked || state.inputAt !== null || state.returned) state.generation++;
  state.tracked = false; state.inputAt = null; state.inactiveSince = null; state.returned = undefined;
}

function observeReturn(state: ReturnState, input: { source: PresenceSource; report: PresenceReportParams; at: number }): void {
  const { source, report, at } = input;
  const evidence = report.lastInput;
  const continuous = state.tracked && at < state.coveredUntil;
  if (!continuous) resetContinuity(state);
  const observedAt = at - report.observedAgeMs;
  const oldSequence = state.sequence;
  state.coveredUntil = source.leaseUntil; state.visible = source.visible;
  if (source.retired || report.inputContinuity !== "tracked" || !evidence
    || evidence.sequence < oldSequence || (evidence.sequence === oldSequence
      && (evidence.ageMs < state.age || evidence.kind !== state.kind))) {
    resetContinuity(state);
    if (evidence) state.sequence = Math.max(state.sequence, evidence.sequence);
    return;
  }
  state.tracked = true;
  if (evidence.sequence > oldSequence) {
    newInput(state, { source, report, at, observedAt, continuous });
  } else if (state.inputAt !== null && evidence.ageMs >= PRESENCE_INPUT_FRESH_MS
    && observedAt - state.inputAt >= PRESENCE_INPUT_FRESH_MS) {
    // The first explicit old-input report establishes a receipt-forward inactive interval.
    // Null reports, expired leases and native visibility alone never establish one.
    state.inactiveSince ??= at;
  }
  state.sequence = evidence.sequence; state.age = evidence.ageMs; state.kind = evidence.kind; state.observedAt = observedAt;
}

function newInput(state: ReturnState, input: {
  source: PresenceSource; report: PresenceReportParams; at: number; observedAt: number; continuous: boolean;
}): void {
  const evidence = input.report.lastInput;
  if (!evidence) return;
  const inputAt = input.observedAt - evidence.ageMs;
  if (inputAt < input.source.createdAt || inputAt < state.observedAt || input.at - inputAt >= PRESENCE_INPUT_FRESH_MS) {
    resetContinuity(state);
    return;
  }
  if (input.continuous && state.inputAt !== null && state.inactiveSince !== null
    && inputAt - state.inactiveSince >= KNOWN_INACTIVE_MS) {
    state.returned = { occurrenceKey: randomUUID(), sourceKey: state.key, sourceGeneration: state.generation,
      observedAt: input.observedAt, inputAt, previousInputAt: state.inputAt, knownInactiveSince: state.inactiveSince };
  }
  state.inputAt = inputAt; state.inactiveSince = null;
}
