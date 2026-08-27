/**
 * INPUT: Core SQLite Run/Attempt/Receipt rows and immutable Run Events
 * OUTPUT: bounded, deterministic, redacted monitor projections for authorized operators
 * POS:    core/observability — read-only projection above the existing Run/Event authority
 */
import {
  RunMonitorListParamsSchema, RunMonitorListResultSchema, RunMonitorSummarySchema,
  TrajectoryInspectorSchema, TrajectoryParamsSchema, TrajectoryResultSchema, TrajectoryRowSchema,
  type MonitorMode, type RunEvent, type RunMonitorListParams, type RunMonitorListResult,
  type RunMonitorSummary, type TrajectoryInspector, type TrajectoryParams, type TrajectoryResult, type TrajectoryRow,
} from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import { payloadDigest, type RunEventRepo } from "../db/run-event-repo.ts";
import { readRunById } from "../db/run-readers.ts";

const INITIATOR_LABEL: Record<string, string> = { primary: "Primary", scheduled: "Scheduled Task", heartbeat: "Heartbeat", flush: "Maintenance", subagent: "Subagent", webhook: "Webhook" };
const DELIVERY_LABEL: Record<string, string> = { class_a: "Class A delivery", class_b: "Class B delivery", internal: "Internal" };

export interface ObservabilityQueryService {
  list(input: RunMonitorListParams): RunMonitorListResult;
  trajectory(input: TrajectoryParams): TrajectoryResult;
  inspect(input: { characterId: string; runKey: string; rowKey: string }): TrajectoryInspector;
  project(event: RunEvent): TrajectoryRow;
  mode(): MonitorMode;
}

// eslint-disable-next-line max-lines-per-function
export function createObservabilityQueryService(input: { db: Database; events: RunEventRepo; mode?: () => MonitorMode; scanLimit?: number }): ObservabilityQueryService {
  const mode = input.mode ?? (() => "DISABLED" as const);
  const scanLimit = Math.max(500, input.scanLimit ?? 50_000);
  const authorize = (characterId: string, runKey: string) => {
    const run = readRunById(input.db, runKey);
    if (run.characterId !== characterId) throw new Error("OBSERVABILITY_FORBIDDEN");
    return run;
  };
  const summary = (runKey: string, characterId: string): RunMonitorSummary => buildSummary(input.db, input.events, authorize(characterId, runKey));
  return {
    mode,
    project: projectEvent,
    list(candidate) {
      const params = RunMonitorListParamsSchema.parse(candidate);
      if (mode() === "DISABLED") return RunMonitorListResultSchema.parse({ runs: [] });
      validateListCursor(input.db, params);
      const matches: Array<{ raw: Record<string, unknown>; run: RunMonitorSummary; events: RunEvent[] }> = [];
      let cursor = params.cursor;
      let scanned = 0;
      let exhausted = false;
      // Event/category predicates need the durable event rows, so walk bounded keyset batches instead of applying one
      // early SQL LIMIT that could falsely report the end of the result set after 500 non-matching Runs.
      while (matches.length < params.limit + 1 && scanned < scanLimit) {
        const rows = input.db.prepare(`SELECT run_id,queued_at,task_id,parent_run_id FROM runs
          WHERE character_id=:characterId ${cursor ? "AND (queued_at < :queuedAt OR (queued_at = :queuedAt AND run_id < :cursorKey))" : ""}
          ORDER BY queued_at DESC,run_id DESC LIMIT 500`).all({
          characterId: params.characterId,
          ...(cursor ? { queuedAt: cursor.queuedAt, cursorKey: cursor.key } : {}),
        }) as Array<Record<string, unknown>>;
        if (rows.length === 0) {
          exhausted = true;
          break;
        }
        scanned += rows.length;
        for (const raw of rows) {
          const item = { raw, run: summary(String(raw.run_id), params.characterId), events: input.events.list(String(raw.run_id)) };
          if (matchesFilters(item, params)) matches.push(item);
        }
        const last = rows.at(-1)!;
        cursor = { queuedAt: String(last.queued_at), key: String(last.run_id) };
        if (rows.length < 500) {
          exhausted = true;
          break;
        }
      }
      const page = matches.slice(0, params.limit); const last = page[page.length - 1];
      // If the bounded scan stopped before reaching the end, continue from the last scanned row even when
      // the current page is not full. Otherwise a large history with sparse filters would silently lose matches.
      const nextCursor = matches.length > page.length && last
        ? { queuedAt: last.run.queuedAt, key: last.run.key }
        : !exhausted && cursor
          ? cursor
          : undefined;
      return RunMonitorListResultSchema.parse({ runs: page.map((item) => item.run), ...(nextCursor ? { nextCursor } : {}) });
    },
    trajectory(candidate) {
      if (mode() === "DISABLED") throw new Error("OBSERVABILITY_DISABLED");
      const params = TrajectoryParamsSchema.parse(candidate); const run = summary(params.runKey, params.characterId);
      if (params.afterSeq > input.events.tail(params.runKey).seq) throw new Error("OBSERVABILITY_CURSOR_STALE");
      const events = input.events.list(params.runKey, params.afterSeq); const rows = events.slice(0, params.limit).map(projectEvent);
      return TrajectoryResultSchema.parse({ run, rows, cursor: { runKey: params.runKey, seq: rows.at(-1)?.seq ?? params.afterSeq }, hasMore: events.length > rows.length });
    },
    inspect({ characterId, runKey, rowKey }) {
      if (mode() === "DISABLED") throw new Error("OBSERVABILITY_DISABLED");
      authorize(characterId, runKey); const event = input.events.list(runKey).find((candidate) => candidate.eventId === rowKey);
      if (!event) throw new Error("OBSERVABILITY_EVENT_NOT_FOUND");
      const safeSummary = "summary" in event.payload && event.payload.summary ? event.payload.summary : "No redacted detail available";
      return TrajectoryInspectorSchema.parse({ mode: mode(), title: humanize(event.kind), technical: [{ label: "Event ID", value: event.eventId }, { label: "Run ID", value: event.runId }, ...(event.attemptId ? [{ label: "Attempt ID", value: event.attemptId }] : []), { label: "Sequence", value: String(event.seq) }, { label: "Schema", value: event.schemaVersion }, { label: "Source", value: event.source }, { label: "Payload digest", value: payloadDigest(event) }], detail: mode() === "FULL_LOCAL" ? [{ label: "Redacted summary", value: safeSummary }] : [], redactionNotice: "Raw prompts, credentials, authorization material, tool payloads, and media bytes are never exposed." });
    },
  };
}

function validateListCursor(db: Database, params: RunMonitorListParams): void {
  if (!params.cursor) return;
  const row = db.prepare("SELECT queued_at FROM runs WHERE run_id=:runId AND character_id=:characterId").get({
    runId: params.cursor.key,
    characterId: params.characterId,
  }) as { queued_at?: unknown } | undefined;
  if (!row || String(row.queued_at) !== params.cursor.queuedAt) throw new Error("OBSERVABILITY_CURSOR_STALE");
}

function buildSummary(db: Database, eventsRepo: RunEventRepo, run: ReturnType<typeof readRunById>): RunMonitorSummary {
  const attempts = db.prepare("SELECT count(*) AS count,min(provider) AS provider,min(model_id) AS model_id FROM run_attempts WHERE run_id=:id").get({ id: run.runId });
  const receipt = db.prepare("SELECT summary,reason FROM run_receipts WHERE run_id=:id").get({ id: run.runId }); const events = eventsRepo.list(run.runId);
  const usage = events.reduce((sum, event) => event.payload.kind === "usage.settled" ? { inputTokens: sum.inputTokens + (event.payload.inputTokens ?? 0), outputTokens: sum.outputTokens + (event.payload.outputTokens ?? 0), totalTokens: sum.totalTokens + (event.payload.totalTokens ?? 0) } : sum, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  const durationMs = run.startedAt && run.terminalAt ? Math.max(0, Date.parse(run.terminalAt) - Date.parse(run.startedAt)) : undefined;
  const effectIds = events.flatMap((event) => isEffectPayload(event.payload) ? [event.payload.effectId] : []);
  return RunMonitorSummarySchema.parse({ key: run.runId, characterId: run.characterId, title: `${INITIATOR_LABEL[run.initiator] ?? humanize(run.initiator)} · ${humanize(run.state)}`, initiator: run.initiator, initiatorLabel: INITIATOR_LABEL[run.initiator] ?? humanize(run.initiator), triggerLabel: humanize(run.provenance.provider), deliveryClass: run.deliveryClass, deliveryLabel: DELIVERY_LABEL[run.deliveryClass] ?? humanize(run.deliveryClass), state: run.state, ...(run.outcome ? { outcome: run.outcome } : {}), queuedAt: run.queuedAt, ...(run.startedAt ? { startedAt: run.startedAt } : {}), ...(run.terminalAt ? { terminalAt: run.terminalAt } : {}), ...(durationMs === undefined ? {} : { durationMs }), attemptCount: Number(attempts?.count ?? 0), effectCount: new Set(effectIds).size, usage, ...(attempts?.provider ? { provider: String(attempts.provider) } : {}), ...(attempts?.model_id ? { modelId: String(attempts.model_id) } : {}), ...(run.parentRunId ? { lineageLabel: "Child Run" } : run.taskId ? { lineageLabel: "Scheduled Task" } : {}), ...(receipt?.summary ? { summary: String(receipt.summary) } : receipt?.reason ? { summary: String(receipt.reason) } : {}) });
}

function projectEvent(event: RunEvent): TrajectoryRow {
  const payload = event.payload; const base = { rowKey: event.eventId, seq: event.seq, ...(event.attemptId ? { groupKey: event.attemptId } : {}), label: humanize(event.kind), ...(isEffectPayload(payload) ? { contextLabel: effectContext(payload.sourceRef) } : {}), phase: phaseOf(event), category: event.category, status: "state" in payload ? humanize(payload.state) : humanize(event.kind), ...( "outcome" in payload && payload.outcome ? { outcome: humanize(payload.outcome) } : {}), occurredAt: event.occurredAt, surface: surfaceOf(event), ...( "summary" in payload && payload.summary ? { summary: payload.summary } : {}), ...( "reason" in payload && payload.reason ? { errorReason: payload.reason } : {}) };
  if (payload.kind === "usage.settled") return TrajectoryRowSchema.parse({ ...base, kind: "usage", inputTokens: payload.inputTokens, outputTokens: payload.outputTokens, totalTokens: payload.totalTokens });
  if (isEffectPayload(payload)) return TrajectoryRowSchema.parse({ ...base, kind: "effect", effectKind: payload.effectKind });
  if (payload.kind === "recovery.classified") return TrajectoryRowSchema.parse({ ...base, kind: "recovery", classification: humanize(payload.classification) });
  if (event.attemptId) return TrajectoryRowSchema.parse({ ...base, kind: "attempt", attemptOrdinal: "attemptOrdinal" in payload ? payload.attemptOrdinal : 1 });
  return TrajectoryRowSchema.parse({ ...base, kind: "lifecycle" });
}

function surfaceOf(event: RunEvent): TrajectoryRow["surface"] {
  if (["attempt.prepared", "effect.intent_committed", "effect.waiting"].includes(event.kind)) return "log-only";
  if (event.kind === "attempt.settled" && event.payload.kind === "attempt.settled" && event.payload.retryability === "retryable") return "shadowed";
  return "current";
}

function effectContext(source: Extract<RunEvent["payload"], { kind: "effect.intent_committed" | "effect.waiting" | "effect.settled" }>["sourceRef"]): string {
  switch (source.type) {
    case "model": return `${source.provider} / ${source.modelId}`;
    case "tool": return source.toolName;
    case "approval": return "Approval decision";
    case "host": return "Host operation";
    case "mcp": return `MCP · ${source.serverId}`;
    case "memory": return `Memory · ${humanize(source.operation)}`;
  }
}

function phaseOf(event: RunEvent): TrajectoryRow["phase"] { if (event.kind === "run.admitted") return "trigger"; if (event.kind.startsWith("attempt.")) return "attempt"; if (event.kind.startsWith("effect.")) return "effect"; if (event.kind.startsWith("usage.")) return "usage"; if (event.kind.startsWith("recovery.")) return "recovery"; return "run"; }
function humanize(value: string): string { return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function matchesFilters(item: { raw: Record<string, unknown>; run: RunMonitorSummary; events: RunEvent[] }, params: RunMonitorListParams): boolean { const run = item.run; if (params.initiators && !params.initiators.includes(run.initiator)) return false; if (params.states && !params.states.includes(run.state)) return false; if (params.outcomes && (!run.outcome || !params.outcomes.includes(run.outcome))) return false; if (params.deliveryClasses && !params.deliveryClasses.includes(run.deliveryClass)) return false; if (params.provider && run.provider !== params.provider) return false; if (params.modelId && run.modelId !== params.modelId) return false; if (params.taskId && item.raw.task_id !== params.taskId) return false; if (params.parentRunId && item.raw.parent_run_id !== params.parentRunId) return false; if (params.categories && !item.events.some((event) => params.categories?.includes(event.category))) return false; if (params.kinds && !item.events.some((event) => params.kinds?.includes(event.kind))) return false; if (params.from && run.queuedAt < params.from) return false; if (params.to && run.queuedAt > params.to) return false; if (params.text && !`${run.title} ${run.triggerLabel} ${run.summary ?? ""}`.toLowerCase().includes(params.text.toLowerCase())) return false; return true; }
function isEffectPayload(payload: RunEvent["payload"]): payload is Extract<RunEvent["payload"], { kind: "effect.intent_committed" | "effect.waiting" | "effect.settled" }> { return payload.kind === "effect.intent_committed" || payload.kind === "effect.waiting" || payload.kind === "effect.settled"; }
