/**
 * INPUT:  Core Run/Attempt/Receipt state and indexed bounded reads of immutable Run Events
 * OUTPUT: authorized, synchronous, deterministic Run lists, forward/tail/before pages, and exact Inspector reads
 * POS:    core/observability — read-only query composition; the Run/Event ledger remains the sole authority
 */
import {
  RunMonitorListParamsSchema, RunMonitorListResultSchema, TrajectoryParamsSchema, TrajectoryResultSchema,
  type MonitorMode, type RunEvent, type RunMonitorListParams, type RunMonitorListResult,
  type RunMonitorSummary, type TrajectoryInspector, type TrajectoryParams, type TrajectoryResult, type TrajectoryRow,
} from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { RunEventRepo } from "../db/run-event-repo.ts";
import { readRunById } from "../db/run-readers.ts";
import { projectEvent } from "./observability-event-projection.ts";
import { inspectEvent } from "./observability-inspector.ts";
import { buildRunSummary } from "./observability-run-summary.ts";
import { matchesRunFilters } from "./observability-run-filters.ts";

export interface ObservabilityQueryService {
  list(input: RunMonitorListParams): RunMonitorListResult;
  trajectory(input: TrajectoryParams): TrajectoryResult;
  inspect(input: { characterId: string; runKey: string; rowKey: string }): TrajectoryInspector;
  project(event: RunEvent): TrajectoryRow;
  mode(): MonitorMode;
}

interface QueryInput {
  db: Database;
  events: RunEventRepo;
  mode?: () => MonitorMode;
  scanLimit?: number;
}

export function createObservabilityQueryService(input: QueryInput): ObservabilityQueryService {
  const mode = input.mode ?? (() => "DISABLED" as const);
  const summary = (runKey: string, characterId: string): RunMonitorSummary =>
    buildRunSummary(input.db, authorize(input.db, characterId, runKey));
  return {
    mode,
    project: projectEvent,
    list: (candidate) => readConsistent(input.db, () => listRuns({
      input, mode: mode(), summary, candidate, scanLimit: Math.max(500, input.scanLimit ?? 50_000),
    })),
    trajectory: (candidate) => readConsistent(input.db, () => {
      if (mode() === "DISABLED") throw new Error("OBSERVABILITY_DISABLED");
      const params = TrajectoryParamsSchema.parse(candidate);
      const run = summary(params.runKey, params.characterId);
      // Ownership is checked before any stale cursor validation or event read.
      const page = input.events.page({
        runId: params.runKey, afterSeq: params.afterSeq, beforeSeq: params.beforeSeq,
        tail: params.tail, limit: params.limit,
      });
      return TrajectoryResultSchema.parse({
        run, rows: page.events.map(projectEvent), cursor: { runKey: params.runKey, seq: page.cursor },
        hasMore: page.hasMore, hasOlder: page.hasOlder,
        ...(page.olderSeq !== undefined ? { olderCursor: { runKey: params.runKey, seq: page.olderSeq } } : {}),
      });
    }),
    inspect: ({ characterId, runKey, rowKey }) => readConsistent(input.db, () => {
      if (mode() === "DISABLED") throw new Error("OBSERVABILITY_DISABLED");
      authorize(input.db, characterId, runKey);
      const event = input.events.get(runKey, rowKey);
      if (!event) throw new Error("OBSERVABILITY_EVENT_NOT_FOUND");
      return inspectEvent(event, mode());
    }),
  };
}

function authorize(db: Database, characterId: string, runKey: string) {
  const run = readRunById(db, runKey);
  if (run.characterId !== characterId) throw new Error("OBSERVABILITY_FORBIDDEN");
  return run;
}

function readConsistent<T>(db: Database, read: () => T): T {
  let value: T;
  db.transaction(() => { value = read(); });
  return value!;
}

function listRuns(args: {
  input: QueryInput;
  mode: MonitorMode;
  scanLimit: number;
  summary(runKey: string, characterId: string): RunMonitorSummary;
  candidate: RunMonitorListParams;
}): RunMonitorListResult {
  const params = RunMonitorListParamsSchema.parse(args.candidate);
  if (args.mode === "DISABLED") return RunMonitorListResultSchema.parse({ runs: [] });
  validateListCursor(args.input.db, params);
  const matches: RunMonitorSummary[] = [];
  let cursor = params.cursor;
  let scanned = 0;
  let exhausted = false;
  while (matches.length <= params.limit && scanned < args.scanLimit) {
    const rows = args.input.db.prepare(`SELECT run_id,queued_at,task_id,parent_run_id FROM runs
      WHERE character_id=:characterId ${cursor ? "AND (queued_at < :queuedAt OR (queued_at = :queuedAt AND run_id < :cursorKey))" : ""}
      ORDER BY queued_at DESC,run_id DESC LIMIT :limit`).all({
      characterId: params.characterId, limit: Math.min(500, args.scanLimit - scanned),
      ...(cursor ? { queuedAt: cursor.queuedAt, cursorKey: cursor.key } : {}),
    });
    if (rows.length === 0) { exhausted = true; break; }
    for (const raw of rows) {
      scanned += 1;
      const run = args.summary(String(raw.run_id), params.characterId);
      cursor = { queuedAt: String(raw.queued_at), key: String(raw.run_id) };
      if (matchesRunFilters({ db: args.input.db, raw, run }, params)) matches.push(run);
      if (matches.length > params.limit) break;
    }
  }
  const page = matches.slice(0, params.limit);
  const last = page.at(-1);
  const nextCursor = matches.length > page.length && last
    ? { queuedAt: last.queuedAt, key: last.key } : !exhausted && cursor ? cursor : undefined;
  return RunMonitorListResultSchema.parse({ runs: page, ...(nextCursor ? { nextCursor } : {}) });
}

function validateListCursor(db: Database, params: RunMonitorListParams): void {
  if (!params.cursor) return;
  const row = db.prepare("SELECT queued_at FROM runs WHERE run_id=:runId AND character_id=:characterId")
    .get({ runId: params.cursor.key, characterId: params.characterId });
  if (!row || String(row.queued_at) !== params.cursor.queuedAt) throw new Error("OBSERVABILITY_CURSOR_STALE");
}
