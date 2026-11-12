/**
 * INPUT: authenticated Character-scoped paging/selection and existing maintenance/auxiliary repositories
 * OUTPUT: bounded background operation summaries and proved per-operation model-call details
 * POS: core/db — read-only Monitor projection; never settles or retries maintenance
 */
import { MaintenanceMonitorParamsSchema, MaintenanceMonitorSnapshotSchema,
  type MaintenanceMonitorParams, type MaintenanceMonitorSnapshot, type MaintenanceMonitorSummary,
  type MaintenanceOperationRef } from "@taki/shared";
import type { Database, SqlRow, SqlValue } from "./sqlite.ts";
import { createMemoryOperationRepo } from "./memory-operation-repo.ts";
import { createCompactionOperationRepo } from "./compaction-operation-repo.ts";
import { createAuxiliaryUsageRepo } from "./auxiliary-usage-repo.ts";

const PAGE_SIZE = 25;
const SOURCES = `SELECT 'tidy' AS kind,operation_id,created_at AS started_at FROM memory_operations
 WHERE kind='tidy' AND json_extract(request_json,'$.characterId')=:characterId
 UNION ALL SELECT 'compact',o.operation_id,e.occurred_at FROM conversation_compaction_operations o
 JOIN conversation_compaction_events e ON e.operation_id=o.operation_id AND e.operation_seq=1
 WHERE o.character_id=:characterId`;

export function createMaintenanceMonitorRepo(db: Database) {
  return { read(candidate: MaintenanceMonitorParams): MaintenanceMonitorSnapshot {
    const params = MaintenanceMonitorParamsSchema.parse(candidate);
    let result!: MaintenanceMonitorSnapshot;
    db.transaction(() => { result = readSnapshot(db, params); });
    return result;
  } };
}

function readSnapshot(db: Database, query: MaintenanceMonitorParams): MaintenanceMonitorSnapshot {
  const bindings: Record<string, SqlValue> = { characterId: query.characterId, limit: PAGE_SIZE + 1 };
  let where = "";
  if (query.cursor) {
    const anchor = db.prepare(`WITH operations AS (${SOURCES}) SELECT started_at FROM operations
      WHERE kind=:kind AND operation_id=:operationId`).get({ characterId: query.characterId,
      kind: query.cursor.kind, operationId: query.cursor.operationId });
    if (anchor?.started_at !== query.cursor.startedAt) throw new Error("OBSERVABILITY_CURSOR_STALE");
    where = "WHERE (started_at,kind,operation_id)<(:startedAt,:kind,:operationId)";
    Object.assign(bindings, query.cursor);
  }
  const candidates = db.prepare(`WITH operations AS (${SOURCES}) SELECT * FROM operations ${where}
    ORDER BY started_at DESC,kind DESC,operation_id DESC LIMIT :limit`).all(bindings);
  const page = candidates.slice(0, PAGE_SIZE);
  const rows = page.map((row) => readSummary(db, { kind: row.kind === "tidy" ? "tidy" : "compact",
    operationId: String(row.operation_id), characterId: query.characterId }, String(row.started_at)));
  const last = page.at(-1);
  const nextCursor = candidates.length > PAGE_SIZE && last ? {
    startedAt: String(last.started_at), kind: last.kind, operationId: String(last.operation_id),
  } : null;
  return MaintenanceMonitorSnapshotSchema.parse({ query, status: "ready", characterId: query.characterId,
    rows, nextCursor, detail: query.selected ? readDetail(db, query) : null });
}

function readDetail(db: Database, query: MaintenanceMonitorParams) {
  const ref = query.selected!;
  const operation = readSummary(db, ref);
  const calls = createAuxiliaryUsageRepo(db).query({ from: "1970-01-01T00:00:00.000Z", to: "9999-12-31T23:59:59.999Z",
    operation: ref, limit: 100, ...(query.callCursor ? { cursor: query.callCursor } : {}) });
  return { operation, calls, association: calls.totalCalls > 0 ? "linked" : "unavailable" };
}

function readSummary(db: Database, ref: MaintenanceOperationRef, startedAt?: string): MaintenanceMonitorSummary {
  return ref.kind === "tidy" ? tidySummary(db, ref) : compactSummary(db, ref, startedAt);
}

function tidySummary(db: Database, ref: MaintenanceOperationRef): MaintenanceMonitorSummary {
  const operation = createMemoryOperationRepo(db).get(ref.operationId);
  if (!operation || operation.request.kind !== "tidy" || operation.request.characterId !== ref.characterId) {
    throw new Error("OBSERVABILITY_FORBIDDEN");
  }
  const outcome = operation.result?.kind === "tidy" ? operation.result.outcome : null;
  const progress = operation.producer?.kind === "tidy" ? operation.producer.progress : undefined;
  const status = operation.terminalAt === null ? "running" : outcome?.status === "partial" ? "partial"
    : operation.state === "outcome_unknown" ? "interrupted" : operation.state === "completed" ? "completed"
      : operation.state === "cancelled" ? "cancelled" : "failed";
  return { ref, startedAt: operation.createdAt, updatedAt: operation.updatedAt, finishedAt: operation.terminalAt, status,
    ...(progress ? { progress: { ...progress,
      reviewed: outcome ? outcome.reviewed ?? null : progress.remaining === null ? null : progress.reviewed } } : {}),
    failure: outcome?.reason ?? (status === "interrupted" ? "interrupted" : status === "failed" ? "execution-failed" : null) };
}

function compactSummary(db: Database, ref: MaintenanceOperationRef, firstStartedAt?: string): MaintenanceMonitorSummary {
  const operation = createCompactionOperationRepo(db).get(ref.operationId);
  if (!operation || operation.characterId !== ref.characterId) throw new Error("OBSERVABILITY_FORBIDDEN");
  const started = firstStartedAt ?? firstCompactionEvent(db, ref.operationId);
  const status = operation.state === "open" ? "running" : operation.state === "committed" ? "completed"
    : operation.state === "abandoned" ? "interrupted" : operation.state;
  const failure = operation.failureCode === "SOURCE_STALE" || operation.failureCode === "SUMMARY_CONFLICT" ? "source-changed"
    : status === "interrupted" ? "interrupted" : status === "failed" ? "summary-failed" : null;
  return { ref, startedAt: started, updatedAt: operation.updatedAt, finishedAt: operation.terminalAt,
    status, failure, attempt: operation.attemptNo };
}

function firstCompactionEvent(db: Database, operationId: string): string {
  const row: SqlRow | undefined = db.prepare(`SELECT occurred_at FROM conversation_compaction_events
    WHERE operation_id=:operationId AND operation_seq=1`).get({ operationId });
  if (typeof row?.occurred_at !== "string") throw new Error("MAINTENANCE_HISTORY_UNAVAILABLE");
  return row.occurred_at;
}
