/**
 * INPUT:  accepted foreground samples, sealed capability provenance, privacy and source retirement
 * OUTPUT: process-local observation epochs, nullable native-presence and continuous application facts
 * POS:    core/perception — single Sampling evidence owner; never associates a Node with an operator device
 */
import type { ForegroundWindowOutput, InitiativeForegroundFact } from "@taki/shared";
import type { CapabilityRouteProvenance } from "../capabilities/route-capability.ts";
import { notifyPerceptionChange } from "./notify-perception-change.ts";
import { nextForegroundFact } from "./foreground-continuity.ts";

export type PerceptionSource = Pick<CapabilityRouteProvenance, "hostId" | "connectionGeneration" | "catalogGeneration">;

export interface AcceptedForegroundEvidence {
  observationEpoch: number;
  observedAt: number;
  /** Nullable session idle is neither physical-HID proof nor the legacy ActivityEntry.idle projection. */
  idleSeconds: number | null;
  source: PerceptionSource;
}

export interface ForegroundEvidenceInput {
  epoch: number;
  observedAt: number;
  sample: ForegroundWindowOutput;
  provenance?: CapabilityRouteProvenance;
}

export interface PerceptionEvidence {
  generation(): number;
  isCurrent(epoch: number, provenance?: CapabilityRouteProvenance): boolean;
  /** False rejects a retired publication. Legacy routes may update UI, but cannot establish native evidence. */
  acceptForeground(input: ForegroundEvidenceInput): boolean;
  latest(now: number): AcceptedForegroundEvidence | undefined;
  /** Same accepted source, without titles; first observations and unobserved gaps cannot establish dwell. */
  foreground(now: number): InitiativeForegroundFact | undefined;
  retire(): void;
  /** A refused sample seals current eligibility without discarding previously accepted activity history. */
  reject(): void;
  retireHost(source: Pick<PerceptionSource, "hostId" | "connectionGeneration">): void;
}

export function samePerceptionSource(left: PerceptionSource, right: PerceptionSource): boolean {
  return left.hostId === right.hostId && left.connectionGeneration === right.connectionGeneration
    && left.catalogGeneration === right.catalogGeneration;
}

interface EvidenceState {
  epoch: number;
  source?: CapabilityRouteProvenance;
  accepted?: AcceptedForegroundEvidence;
  foreground?: InitiativeForegroundFact;
}

export function createPerceptionEvidence(deps: {
  isPaused: () => boolean;
  freshnessMs: number;
  onRetire: (clearHistory: boolean) => void;
  onChange?: () => void;
}): PerceptionEvidence {
  const state: EvidenceState = { epoch: 0 };
  const invalidate = (clearHistory: boolean) => {
    const hadSource = state.source !== undefined;
    state.epoch += 1;
    state.source = undefined;
    state.accepted = undefined;
    state.foreground = undefined;
    if (clearHistory || hadSource) deps.onRetire(clearHistory);
    if (hadSource) notifyPerceptionChange(deps.onChange);
  };
  const retire = () => invalidate(true);
  const generation = () => {
    if (state.source && !state.source.isCurrent()) retire();
    return state.epoch;
  };
  const isCurrent = (epoch: number, source?: CapabilityRouteProvenance) =>
    !deps.isPaused() && generation() === epoch && (source?.isCurrent() ?? true);
  return {
    generation,
    isCurrent,
    retire,
    reject: () => invalidate(false),
    retireHost(source) {
      // An old socket's delayed cleanup cannot retire the replacement's accepted observations.
      if (state.source?.hostId === source.hostId && state.source.connectionGeneration === source.connectionGeneration) retire();
    },
    acceptForeground(input) {
      if (!isCurrent(input.epoch, input.provenance)) return false;
      if (!input.sample.available) { invalidate(false); return false; }
      const accepted = acceptForeground(state, input, retire);
      if (accepted) state.foreground = nextForegroundFact({ previous: state.foreground, accepted: input, epoch: state.epoch, freshnessMs: deps.freshnessMs });
      return accepted;
    },
    latest(now) {
      generation();
      return deps.isPaused() ? undefined : latestNative(state, now, deps.freshnessMs);
    },
    foreground(now) {
      generation();
      return deps.isPaused() ? undefined : latestForeground(state, now, deps.freshnessMs);
    },
  };
}

function latestNative(state: EvidenceState, now: number, freshnessMs: number): AcceptedForegroundEvidence | undefined {
  const accepted = state.accepted;
  if (!accepted || now < accepted.observedAt || now - accepted.observedAt > freshnessMs) return undefined;
  return { ...accepted, source: { ...accepted.source } };
}

function latestForeground(state: EvidenceState, now: number, freshnessMs: number): InitiativeForegroundFact | undefined {
  const fact = state.foreground;
  if (!fact || now < fact.observedAt || now - fact.observedAt >= freshnessMs) return undefined;
  return { ...fact };
}

function acceptForeground(state: EvidenceState, input: ForegroundEvidenceInput, retire: () => void): boolean {
  const source = input.provenance;
  if (!source) {
    // Preserve old local activity fixtures/consumers without laundering an unbound sample into presence.
    if (state.source) retire();
    return true;
  }
  if (state.source && !samePerceptionSource(state.source, source)) retire();
  state.source = source;
  state.accepted = {
    observationEpoch: state.epoch,
    observedAt: input.observedAt,
    idleSeconds: input.sample.idleSeconds,
    source: { hostId: source.hostId, connectionGeneration: source.connectionGeneration, catalogGeneration: source.catalogGeneration },
  };
  return true;
}
