/**
 * INPUT:  validated Run facts and bounded per-Run sequence or exact-event queries
 * OUTPUT: append-only events, indexed chronological pages, exact lookup, and durable tail cursors
 * POS:    core/db — canonical event ledger; paging never materializes an entire Run for a projection
 */
import { randomUUID, createHash } from "node:crypto";
import { RunEventCursorSchema, RunEventSchema, type RunEvent, type RunEventCursor } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export interface RunEventPageQuery {
  runId: string;
  afterSeq?: number;
  beforeSeq?: number;
  tail?: true;
  limit: number;
}
export interface RunEventPage {
  events: RunEvent[];
  cursor: number;
  hasMore: boolean;
  hasOlder: boolean;
  olderSeq?: number;
}

export interface RunEventRepo {
  append(event: Omit<RunEvent, "eventId" | "seq">): RunEvent;
  appendMany(events: Array<Omit<RunEvent, "eventId" | "seq">>): RunEvent[];
  list(runId: string, afterSeq?: number): RunEvent[];
  page(query: RunEventPageQuery): RunEventPage;
  get(runId: string, eventId: string): RunEvent | undefined;
  tail(runId: string): RunEventCursor;
}

export function createRunEventRepo(db: Database): RunEventRepo {
  const appendMany = (events: Array<Omit<RunEvent, "eventId" | "seq">>): RunEvent[] => appendBatch(db, events);
  return {
    append: (event) => appendMany([event])[0]!,
    appendMany,
    list(runId, afterSeq = 0) {
      const cursor = RunEventCursorSchema.parse({ runId, seq: afterSeq });
      return db.prepare("SELECT * FROM run_events WHERE run_id=:runId AND seq>:after ORDER BY seq")
        .all({ runId: cursor.runId, after: cursor.seq }).map(readEvent);
    },
    page: (query) => readPage(db, query),
    get(runId, eventId) {
      const row = db.prepare("SELECT * FROM run_events WHERE run_id=:runId AND event_id=:eventId")
        .get({ runId, eventId });
      return row ? readEvent(row) : undefined;
    },
    tail: (runId) => readTail(db, runId),
  };
}

function readEvent(row: Record<string, unknown>): RunEvent {
  return RunEventSchema.parse({
    eventId: row.event_id, runId: row.run_id, attemptId: row.attempt_id ?? undefined,
    seq: Number(row.seq), schemaVersion: row.schema_version, category: row.category, kind: row.kind,
    occurredAt: row.occurred_at, source: row.source,
    ...(row.correlation_json ? { correlation: JSON.parse(String(row.correlation_json)) } : {}),
    payload: JSON.parse(String(row.payload_json)),
  });
}

function appendBatch(db: Database, events: Array<Omit<RunEvent, "eventId" | "seq">>): RunEvent[] {
  if (events.length === 0) return [];
  const runId = events[0]!.runId;
  if (events.some((event) => event.runId !== runId)) throw new Error("RUN_EVENT_BATCH_RUN_MISMATCH");
  let committed: RunEvent[] = [];
  db.transaction(() => {
    const row = db.prepare("SELECT COALESCE(max(seq),0) AS max_seq, count(*) AS count FROM run_events WHERE run_id=:runId")
      .get({ runId });
    const maxSeq = Number(row?.max_seq ?? 0);
    if (Number(row?.count ?? 0) !== maxSeq) throw new Error("RUN_EVENT_SEQUENCE_CORRUPT");
    const statement = db.prepare(`INSERT INTO run_events
      (event_id,run_id,attempt_id,seq,schema_version,category,kind,occurred_at,source,correlation_json,payload_json)
      VALUES (:eventId,:runId,:attemptId,:seq,:schemaVersion,:category,:kind,:occurredAt,:source,:correlation,:payload)`);
    committed = events.map((candidate, index) => {
      const event = RunEventSchema.parse({ ...candidate, eventId: randomUUID(), seq: maxSeq + 1 + index });
      statement.run({
        eventId: event.eventId, runId: event.runId, attemptId: event.attemptId ?? null, seq: event.seq,
        schemaVersion: event.schemaVersion, category: event.category, kind: event.kind,
        occurredAt: event.occurredAt, source: event.source,
        correlation: "correlation" in event && event.correlation ? JSON.stringify(event.correlation) : null, payload: JSON.stringify(event.payload),
      });
      return event;
    });
  });
  return committed;
}

function readTail(db: Database, runId: string): RunEventCursor {
  const cursor = RunEventCursorSchema.parse({ runId, seq: 0 });
  const seq = Number(db.prepare("SELECT COALESCE(max(seq),0) AS seq FROM run_events WHERE run_id=:runId")
    .get({ runId: cursor.runId })?.seq ?? 0);
  return RunEventCursorSchema.parse({ runId: cursor.runId, seq });
}

function readPage(db: Database, query: RunEventPageQuery): RunEventPage {
  const afterSeq = query.afterSeq ?? 0;
  validatePage(query, afterSeq);
  const tail = readTail(db, query.runId).seq;
  if (afterSeq > tail || (query.beforeSeq !== undefined && query.beforeSeq > tail + 1)) {
    throw new Error("OBSERVABILITY_CURSOR_STALE");
  }
  const backward = query.tail || query.beforeSeq !== undefined;
  const predicate = backward ? "seq < :boundary" : "seq > :boundary";
  const candidates = db.prepare(`SELECT * FROM run_events WHERE run_id=:runId AND ${predicate}
    ORDER BY seq ${backward ? "DESC" : "ASC"} LIMIT :limit`).all({
    runId: query.runId, boundary: backward ? query.beforeSeq ?? tail + 1 : afterSeq, limit: query.limit + 1,
  });
  const events = candidates.slice(0, query.limit).map(readEvent);
  if (backward) events.reverse();
  const oldest = events[0]?.seq;
  const hasOlder = oldest !== undefined ? oldest > 1 : !backward && afterSeq > 0;
  return {
    events, cursor: events.at(-1)?.seq ?? (backward ? 0 : afterSeq),
    hasMore: !backward && candidates.length > query.limit, hasOlder,
    ...(hasOlder && oldest !== undefined ? { olderSeq: oldest } : {}),
  };
}

function validatePage(query: RunEventPageQuery, afterSeq: number): void {
  RunEventCursorSchema.parse({ runId: query.runId, seq: afterSeq });
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) throw new Error("RUN_EVENT_INVALID_LIMIT");
  if (query.beforeSeq !== undefined) {
    RunEventCursorSchema.parse({ runId: query.runId, seq: query.beforeSeq });
    if (query.beforeSeq === 0) throw new Error("RUN_EVENT_INVALID_CURSOR");
  }
  if ((query.tail && query.beforeSeq !== undefined) || ((query.tail || query.beforeSeq !== undefined) && afterSeq !== 0)) {
    throw new Error("RUN_EVENT_INVALID_CURSOR");
  }
}

export function payloadDigest(event: RunEvent): string {
  return createHash("sha256").update(JSON.stringify(event.payload)).digest("hex");
}
