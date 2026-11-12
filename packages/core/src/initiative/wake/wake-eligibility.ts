/**
 * INPUT: captured selection, current authorities and the canonical accounting read model
 * OUTPUT: deterministic common gates and retained opportunity/delivery currentness
 * POS: core/initiative/wake — fail-closed policy; no state mutations or model access
 */
import type { InitiativeWakeReason } from "@taki/shared";
import type { InitiativeWakeDependencies, InitiativeWakeSnapshot, WakeSelection } from "./wake-contract.ts";
import { inQuietHours } from "./wake-clock.ts";
import { WAKE_SOURCE_FRESH_MS } from "./wake-matcher.ts";
import { matchWakeSources } from "./wake-candidates.ts";
import { currentIntentionSnapshot } from "./wake-intention-lifecycle.ts";
import { readUtteranceBudget, readWakeBudget } from "./wake-budget.ts";

export function commonWakeRefusal(deps: InitiativeWakeDependencies, snapshot: InitiativeWakeSnapshot, now: number): InitiativeWakeReason | undefined {
  if (!snapshot.enabled) return "disabled";
  const wake = deps.wakePolicy();
  if (!wake.periodicEnabled && !wake.eventsEnabled) return "wake-disabled";
  if (!snapshot.targetId || !snapshot.targetReady) return "no-target";
  if (inQuietHours(now, snapshot.timezone, wake)) return "quiet-hours";
  const backoff = deps.backoff?.refusal(snapshot.targetId);
  if (backoff) return backoff;
  return readWakeBudget(deps.db, { now, timezone: snapshot.timezone, policy: deps.policy(), wake });
}

export function selectionCurrent(deps: InitiativeWakeDependencies, selection: WakeSelection, now: number): boolean {
  if (selection.expiresAt <= now) return false;
  try {
    // Policy/release notifications still retire work; they are not a third enabled source.
    const wake = deps.wakePolicy();
    if (!wake.periodicEnabled && !wake.eventsEnabled) return false;
    if (deps.contextIsCurrent && !deps.contextIsCurrent(selection)) return false;
    if (deps.sourceIsCurrent && !deps.sourceIsCurrent(selection)) return false;
    const current = deps.snapshot();
    const before = selection.snapshot;
    if (!current.enabled || !current.targetReady || current.targetId !== before.targetId
      || current.policyRevision !== before.policyRevision || current.timezoneRevision !== before.timezoneRevision
      || current.timezone !== before.timezone || current.primaryVersion !== before.primaryVersion) return false;
    if (!optionalSamplingCurrent(selection, current, now)) return false;
    const matches = matchWakeSources(deps.patterns.listActive(selection.characterId),
      currentIntentionSnapshot(deps, selection, current), now).candidates;
    return selection.candidates.every((candidate) => matches.some((match) => match.candidateId === candidate.candidateId
      && match.revisionId === candidate.revisionId && match.sourceRevision === candidate.sourceRevision));
  } catch { return false; }
}

function optionalSamplingCurrent(selection: WakeSelection, current: InitiativeWakeSnapshot, now: number): boolean {
  const before = selection.snapshot.foreground;
  const used = before && !selection.snapshot.privacyPaused && selection.candidates.some((candidate) =>
    candidate.definition.contextSelectors.some((selector) => selector === "accepted_activity" || selector === "accepted_screen"));
  if (!used || !before) return true;
  const after = current.foreground;
  return !current.privacyPaused && after !== null && now >= before.observedAt && now - before.observedAt < WAKE_SOURCE_FRESH_MS
    && after.occurrenceKey === before.occurrenceKey && after.observationEpoch === before.observationEpoch
    && after.hostId === before.hostId && after.connectionGeneration === before.connectionGeneration
    && after.catalogGeneration === before.catalogGeneration;
}

export function wakeDeliveryGate(deps: InitiativeWakeDependencies, selection: WakeSelection, now: number): "ready" | "hold" | "suppress" {
  if (!selectionCurrent(deps, selection, now)) return "suppress";
  const current = deps.snapshot();
  if (inQuietHours(now, current.timezone, deps.wakePolicy())) return "suppress";
  if (readUtteranceBudget(deps.db, { now, timezone: current.timezone, policy: deps.policy() })) return "suppress";
  // C1 holds the background lane while calling this gate. A newly arrived primary intent
  // changes primaryVersion above; inspecting lane occupancy here would see our own Run.
  return "ready";
}
