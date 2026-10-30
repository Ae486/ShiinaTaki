/**
 * INPUT: connection-bound source/exposure reports, accepted native evidence and published Timeline
 * OUTPUT: qualified presence, confirmed same-device opportunity unions and durable feedback
 * POS: core/presence — report authority; no Host availability or reading inference
 */
import { PresenceReportParamsSchema, TimelinePresentationReportParamsSchema,
  type PresenceReportParams, type PresenceReportResult, type PresenceSnapshot, type TimelinePresentationReportParams,
  type InitiativePresenceReturn } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { Connection, ConnectionRegistry } from "../server/connection-registry.ts";
import type { InitiativeFeedbackRepo } from "./initiative-feedback-repo.ts";
import { createPresenceSources, type PresenceSource } from "./presence-sources.ts";
import { intersectIntervals } from "./observed-intervals.ts";
import { PRESENCE_INPUT_FRESH_MS, PRESENCE_LEASE_MS, PRESENCE_MAX_EXPOSURES, PRESENCE_NATIVE_IDLE_SECONDS } from "./presence-policy.ts";

interface Exposure { characterId: string; timelineSeq: number; confirmedAt: number; leaseUntil: number }
export interface PresenceService {
  reportPresence(connection: Connection, report: PresenceReportParams): PresenceReportResult;
  reportPresentation(connection: Connection, report: TimelinePresentationReportParams): PresenceReportResult;
  snapshot(): PresenceSnapshot;
  recentReturn(): InitiativePresenceReturn | undefined;
  sweep(): void;
  retireConnection(connection: Connection): void;
  observeUserTurn(characterId: string, createdAt?: string): void;
  close(): void;
}
interface Dependencies {
  db: Database;
  connections: ConnectionRegistry;
  feedback: InitiativeFeedbackRepo;
  now?: () => number;
  nativeEvidence?: () => { observedAt: number; idleSeconds: number | null } | undefined;
  onSourceChanged?: () => void;
}

export function createPresenceService(input: Dependencies): PresenceService {
  const now = input.now ?? Date.now;
  const sources = createPresenceSources({ connections: input.connections, now, onChange: input.onSourceChanged });
  const exposures = new WeakMap<PresenceSource, Map<number, Exposure>>();
  let closed = false;
  const settle = () => { input.feedback.syncPublished(); input.feedback.settleDue(now()); };
  const confirm = (source: PresenceSource, exposure: Exposure, end: number) => {
    if (now() > exposure.leaseUntil) return;
    const interval = [exposure.confirmedAt, Math.min(end, exposure.leaseUntil)] as const;
    for (const [start, finish] of intersectIntervals(interval, sources.deviceIntervals(source.deviceId))) {
      input.feedback.observeInterval({ characterId: exposure.characterId, timelineSeq: exposure.timelineSeq, start, end: finish });
    }
  };
  const retireConnection = (connection: Connection) => {
    const source = sources.get(connection);
    if (source) exposures.delete(source);
    sources.retire(connection);
  };
  input.connections.onRemove(retireConnection);
  const state = { input, now, sources, exposures, settle, confirm, isClosed: () => closed };
  return {
    reportPresence: (connection, report) => reportPresence(state, connection, report),
    reportPresentation: (connection, report) => reportPresentation(state, connection, report),
    snapshot: () => snapshot(input, sources.live(), now()),
    recentReturn: () => sources.recentReturn(),
    sweep() {
      if (closed) return;
      settle();
      for (const source of sources.live()) {
        for (const [seq, exposure] of exposures.get(source) ?? []) {
          if (exposure.leaseUntil <= now()) exposures.get(source)?.delete(seq);
        }
      }
    },
    retireConnection,
    observeUserTurn(characterId, createdAt) {
      if (closed) return;
      input.feedback.syncPublished(); input.feedback.engage(characterId, createdAt === undefined ? now() : Date.parse(createdAt));
    },
    close() { closed = true; sources.clear(); },
  };
}
interface ServiceState {
  input: Dependencies; now(): number; sources: ReturnType<typeof createPresenceSources>;
  exposures: WeakMap<PresenceSource, Map<number, Exposure>>;
  settle(): void; confirm(source: PresenceSource, exposure: Exposure, end: number): void; isClosed(): boolean;
}

function reportPresence(state: ServiceState, connection: Connection, candidate: PresenceReportParams): PresenceReportResult {
  if (state.isClosed()) return { status: "refused", reason: "stale-source" };
  const parsed = PresenceReportParamsSchema.safeParse(candidate);
  if (!parsed.success) return { status: "refused", reason: "invalid-report" };
  const report = parsed.data;
  const before = state.sources.get(connection);
  const expired = before !== undefined && before.leaseUntil <= state.now();
  const result = state.sources.report(connection, report);
  if (result.status === "refused") return result;
  const closing = before && (expired || !report.visible || report.state === "retired");
  const previous = closing ? state.exposures.get(before) : undefined;
  // Live negative evidence is irreversible even if an unrelated durable feedback write fails.
  if (closing) state.exposures.delete(before);
  state.settle();
  if (before && !expired) for (const exposure of previous?.values() ?? []) {
    state.confirm(before, exposure, state.now() - report.observedAgeMs);
  }
  return result;
}

function reportPresentation(state: ServiceState, connection: Connection, candidate: TimelinePresentationReportParams): PresenceReportResult {
  if (state.isClosed()) return { status: "refused", reason: "stale-source" };
  const parsed = TimelinePresentationReportParamsSchema.safeParse(candidate);
  if (!parsed.success) return { status: "refused", reason: "invalid-report" };
  const report = parsed.data;
  const source = state.sources.get(connection);
  const items = source && state.exposures.get(source);
  const previous = items?.get(report.timelineSeq);
  const failure = state.sources.validate(connection, report);
  // A known exposure's valid end must survive quota exhaustion, or a later show report
  // would confirm the hidden gap. Other refusals keep their auth/sequence/age fencing.
  const closesExposure = !report.exposed && previous?.characterId === report.characterId;
  if (failure && (failure.reason !== "rate-limited" || !closesExposure)) return failure;
  if (!source || source.leaseUntil <= state.now() || (report.exposed && !source.visible)) return { status: "refused", reason: "stale-source" };
  if (!validMessage(state.input.db, report)) return { status: "refused", reason: "unknown-message" };
  const next = items ?? new Map<number, Exposure>();
  if (report.exposed && !previous && next.size >= PRESENCE_MAX_EXPOSURES) return { status: "refused", reason: "exposure-limit" };
  if (!report.exposed) {
    // Do not let sync/settlement or interval persistence failure keep a hidden exposure alive.
    next.delete(report.timelineSeq); state.exposures.set(source, next); state.sources.accept(source, report);
  }
  state.settle();
  if (previous) state.confirm(source, previous, state.now() - report.observedAgeMs);
  if (report.exposed) {
    state.input.feedback.present(report);
    next.set(report.timelineSeq, { characterId: report.characterId, timelineSeq: report.timelineSeq,
      confirmedAt: state.now(), leaseUntil: Math.min(source.leaseUntil, state.now() - report.observedAgeMs + PRESENCE_LEASE_MS) });
    state.exposures.set(source, next); state.sources.accept(source, report);
  }
  return { status: "accepted", leaseMs: Math.max(0, source.leaseUntil - state.now()) };
}

function validMessage(db: Database, reference: TimelinePresentationReportParams): boolean {
  const row = db.prepare(`SELECT content FROM timeline_messages WHERE character_id=:characterId
    AND seq=:seq AND role='assistant'`).get({ characterId: reference.characterId, seq: reference.timelineSeq });
  // SQLite trim() removes spaces only; a blank Markdown row cannot prove text presentation.
  return typeof row?.content === "string" && row.content.trim().length > 0;
}

function snapshot(input: Dependencies, sources: readonly PresenceSource[], at: number): PresenceSnapshot {
  const native = input.nativeEvidence?.();
  const nativeFresh = native && native.observedAt <= at && at - native.observedAt < PRESENCE_INPUT_FRESH_MS
    && native.idleSeconds !== null && native.idleSeconds >= 0 && Number.isFinite(native.idleSeconds);
  const nativePresence = !nativeFresh || native.idleSeconds === null ? "unknown"
    : native.idleSeconds < PRESENCE_NATIVE_IDLE_SECONDS ? "present" : "inactive";
  const inputFreshSources = sources.filter((source) => source.intervals.some(([start, end]) => start <= at && end > at)).length;
  return { state: inputFreshSources > 0 || nativePresence === "present" ? "present" : "unknown",
    sourceCount: sources.length, deviceCount: new Set(sources.map((source) => source.deviceId)).size,
    inputFreshSources, nativePresence, observedAt: new Date(at).toISOString() };
}
