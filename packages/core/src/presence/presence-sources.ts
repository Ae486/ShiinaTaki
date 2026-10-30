/**
 * INPUT: authenticated connection lifetimes and bounded operator reports
 * OUTPUT: independent ephemeral leases and same-device direct-input intervals
 * POS: core/presence — no device co-location inference or persistent live evidence
 */
import type { InitiativePresenceReturn, PresenceReportParams, PresenceReportResult } from "@taki/shared";
import type { Connection, ConnectionRegistry } from "../server/connection-registry.ts";
import { unionIntervals, type ObservedInterval } from "./observed-intervals.ts";
import { PRESENCE_INPUT_FRESH_MS, PRESENCE_LEASE_MS, PRESENCE_MAX_INTERVALS, PRESENCE_MAX_SOURCES,
  PRESENCE_REPORT_BURST, PRESENCE_REPORTS_PER_SECOND } from "./presence-policy.ts";
import { createPresenceReturnTracker } from "./presence-return.ts";

type Refusal = Extract<PresenceReportResult, { status: "refused" }>;
export interface PresenceSource {
  connection: Connection; authentication: Connection["state"]; sourceId: string; deviceId: string; surface: PresenceReportParams["surface"];
  sequence: number; observedAt: number; createdAt: number; leaseUntil: number; retired: boolean;
  visible: boolean; focused: boolean; inputAt: number | null;
  inputSequence: number; inputAge: number; inputKind: string | null;
  reportTokens: number; tokenAt: number;
  intervals: ObservedInterval[];
}
interface SequenceReport { sourceId: string; sequence: number; observedAgeMs: number }
export interface PresenceSources {
  get(connection: Connection): PresenceSource | undefined;
  validate(connection: Connection, report: SequenceReport): Refusal | undefined;
  report(connection: Connection, report: PresenceReportParams): PresenceReportResult;
  accept(source: PresenceSource, report: SequenceReport): void;
  retire(connection: Connection): void;
  live(): PresenceSource[];
  deviceIntervals(deviceId: string): ObservedInterval[];
  recentReturn(): InitiativePresenceReturn | undefined;
  clear(): void;
}

export function createPresenceSources(input: { connections: ConnectionRegistry; now(): number; onChange?: () => void }): PresenceSources {
  const bound = new WeakMap<Connection, PresenceSource>();
  const retained = new Set<PresenceSource>();
  const returns = createPresenceReturnTracker(input.onChange);
  const authenticated = (connection: Connection) => connection.state.status === "authenticated"
    && connection.state.role === "operator" && input.connections.list().includes(connection);
  const prune = () => {
    const cutoff = input.now() - 2 * PRESENCE_LEASE_MS;
    for (const source of retained) {
      if (!source.retired && (!authenticated(source.connection) || source.connection.state !== source.authentication)) {
        // An unobserved authority change has no trustworthy end time. Discard its evidence;
        // normal connection removal uses retire() and can preserve the known earlier interval.
        source.retired = true; source.leaseUntil = Math.min(source.leaseUntil, input.now()); source.intervals = [];
        returns.retire(source);
      }
      source.intervals = source.intervals.filter((interval) => interval[1] > cutoff);
      if (source.leaseUntil <= cutoff) retained.delete(source);
    }
  };
  const validate = (connection: Connection, report: SequenceReport): Refusal | undefined => {
    if (!authenticated(connection)) return refused("unauthorized");
    const source = bound.get(connection);
    if (!source || source.sourceId !== report.sourceId || source.retired || connection.state !== source.authentication || connection.state.status !== "authenticated"
      || connection.state.deviceId !== source.deviceId) return refused("stale-source");
    if (report.sequence <= source.sequence) return refused("stale-sequence");
    if (input.now() - report.observedAgeMs < source.observedAt || report.observedAgeMs >= PRESENCE_LEASE_MS) {
      return refused("stale-observation");
    }
    return consumeReportToken(source, input.now()) ? undefined : refused("rate-limited");
  };
  const accept = (source: PresenceSource, report: SequenceReport) => {
    source.sequence = report.sequence;
    source.observedAt = input.now() - report.observedAgeMs;
  };
  const live = () => { prune(); return [...retained].filter((source) => !source.retired && source.leaseUntil > input.now()); };
  const state = { bound, retained, returns, now: input.now, authenticated, validate, accept, prune };
  return {
    get: (connection) => bound.get(connection), validate, accept,
    report: (connection, report) => updateSource(state, connection, report),
    retire: (connection) => retireSource(bound.get(connection), input.now(), returns),
    live,
    recentReturn: () => returns.recent(live(), input.now()),
    deviceIntervals(deviceId) {
      prune();
      return unionIntervals([...retained].filter((source) => source.deviceId === deviceId).flatMap((source) => source.intervals));
    },
    clear() { for (const source of retained) { source.retired = true; returns.retire(source); } retained.clear(); },
  };
}

function retireSource(source: PresenceSource | undefined, at: number, returns: ReturnType<typeof createPresenceReturnTracker>): void {
  if (!source) return;
  source.retired = true; source.leaseUntil = Math.min(source.leaseUntil, at);
  source.intervals = clipIntervals(source.intervals, source.leaseUntil);
  returns.retire(source);
}
interface SourceState {
  bound: WeakMap<Connection, PresenceSource>; retained: Set<PresenceSource>; now(): number;
  authenticated(connection: Connection): boolean;
  validate: PresenceSources["validate"]; accept: PresenceSources["accept"]; prune(): void;
  returns: ReturnType<typeof createPresenceReturnTracker>;
}

function updateSource(state: SourceState, connection: Connection, report: PresenceReportParams): PresenceReportResult {
  if (!state.authenticated(connection)) return refused("unauthorized");
  state.prune();
  let source = state.bound.get(connection);
  let observation = report;
  let returnObservation = report;
  if (!source) {
    if (report.sequence !== 1 || report.lastInput !== null || report.state !== "active" || report.observedAgeMs >= PRESENCE_LEASE_MS) {
      return refused("stale-source");
    }
    if (state.retained.size >= PRESENCE_MAX_SOURCES) return refused("source-limit");
    source = makeSource(connection, report, state.now());
  } else {
    const failure = state.validate(connection, report);
    const closesEvidence = report.state === "retired" || (source.visible && !report.visible);
    if (failure && (failure.reason !== "rate-limited" || !closesEvidence)) return failure;
    if (failure) returnObservation = { ...report, inputContinuity: "suspended", lastInput: null };
    if (source.surface !== report.surface) return refused("stale-source");
    if (!state.retained.has(source) && state.retained.size >= PRESENCE_MAX_SOURCES) return refused("source-limit");
    if (!closesEvidence && !validInput(source, report, state.now())) return refused("stale-input");
    // Negative lifecycle evidence is independent of attached positive input, which may
    // already be stale. Close its intervals without allowing input to veto or piggyback.
    if (closesEvidence) observation = { ...report, lastInput: null };
  }
  updateInput(source, observation, state.now());
  state.accept(source, report);
  state.bound.set(connection, source); state.retained.add(source);
  state.returns.observe(source, returnObservation, state.now());
  return { status: "accepted", leaseMs: source.retired ? 0 : Math.max(0, source.leaseUntil - state.now()) };
}

function validInput(source: PresenceSource, report: PresenceReportParams, at: number): boolean {
  const evidence = report.lastInput;
  if (!evidence) return true;
  if (evidence.sequence < source.inputSequence) return false;
  // Client elapsed age excludes network transit. Requiring it to match Core receipt deltas
  // rejects ordinary jitter; the immutable inputAt still caps freshness even if age freezes.
  if (evidence.sequence === source.inputSequence) return evidence.ageMs >= source.inputAge && evidence.kind === source.inputKind
    && source.inputAt !== null;
  const inputAt = at - report.observedAgeMs - evidence.ageMs;
  // Distinct trusted events can share millisecond precision; equality adds no fresh time.
  return inputAt >= source.createdAt && (source.inputAt === null || inputAt >= source.inputAt);
}

function updateInput(source: PresenceSource, report: PresenceReportParams, at: number): void {
  const observedAt = at - report.observedAgeMs;
  const evidence = report.lastInput;
  if (evidence) {
    if (evidence.sequence > source.inputSequence) source.inputAt = observedAt - evidence.ageMs;
    source.inputSequence = evidence.sequence; source.inputAge = evidence.ageMs; source.inputKind = evidence.kind;
  }
  source.visible = report.visible; source.focused = report.focused;
  source.retired = report.state === "retired";
  source.leaseUntil = source.retired ? observedAt : observedAt + PRESENCE_LEASE_MS;
  if (!evidence || source.retired) source.intervals = clipIntervals(source.intervals, observedAt);
  else if (source.inputAt !== null) {
    const end = Math.min(source.leaseUntil, source.inputAt + PRESENCE_INPUT_FRESH_MS);
    // Only receipt-forward evidence is admitted; a report never fills an earlier unknown gap.
    source.intervals = unionIntervals([...source.intervals, [at, end]]).slice(-PRESENCE_MAX_INTERVALS);
  }
}

function makeSource(connection: Connection, report: PresenceReportParams, at: number): PresenceSource {
  if (connection.state.status !== "authenticated") throw new Error("presence source requires authentication");
  return { connection, authentication: connection.state, sourceId: report.sourceId, deviceId: connection.state.deviceId, surface: report.surface,
    sequence: 0, observedAt: at - report.observedAgeMs, createdAt: at, leaseUntil: at,
    retired: false, visible: false, focused: false, inputAt: null, inputSequence: 0, inputAge: 0, inputKind: null,
    reportTokens: PRESENCE_REPORT_BURST - 1, tokenAt: at, intervals: [] };
}

function consumeReportToken(source: PresenceSource, at: number): boolean {
  source.reportTokens = Math.min(PRESENCE_REPORT_BURST, source.reportTokens + Math.max(0, at - source.tokenAt) * PRESENCE_REPORTS_PER_SECOND / 1_000);
  source.tokenAt = at;
  if (source.reportTokens < 1) return false;
  source.reportTokens--;
  return true;
}

function clipIntervals(intervals: readonly ObservedInterval[], end: number): ObservedInterval[] {
  return intervals.map(([start, priorEnd]) => [start, Math.min(priorEnd, end)] as const).filter(([start, finish]) => finish > start);
}

function refused(reason: Refusal["reason"]): Refusal { return { status: "refused", reason }; }
