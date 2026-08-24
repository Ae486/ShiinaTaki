import { randomUUID, createHash } from "node:crypto";
import { RunEventCursorSchema, RunEventSchema, type RunEvent, type RunEventCursor } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export interface RunEventRepo {
  append(event: Omit<RunEvent, "eventId" | "seq">): RunEvent;
  appendMany(events: Array<Omit<RunEvent, "eventId" | "seq">>): RunEvent[];
  list(runId: string, afterSeq?: number): RunEvent[];
  tail(runId: string): RunEventCursor;
}

export function createRunEventRepo(db: Database): RunEventRepo {
  const read = (row: Record<string, unknown>): RunEvent => RunEventSchema.parse({ eventId: row.event_id, runId: row.run_id, attemptId: row.attempt_id ?? undefined, seq: Number(row.seq), schemaVersion: row.schema_version, category: row.category, kind: row.kind, occurredAt: row.occurred_at, source: row.source, correlation: row.correlation_json ? JSON.parse(String(row.correlation_json)) : undefined, payload: JSON.parse(String(row.payload_json)) });
  const appendMany = (events: Array<Omit<RunEvent, "eventId" | "seq">>): RunEvent[] => {
    if (events.length === 0) return [];
    const runId = events[0]!.runId;
    if (events.some((event) => event.runId !== runId)) throw new Error("RUN_EVENT_BATCH_RUN_MISMATCH");
    let committed: RunEvent[] = [];
    db.transaction(() => {
      const row = db.prepare("SELECT COALESCE(max(seq),0) AS max_seq, count(*) AS count FROM run_events WHERE run_id=:runId").get({ runId });
      const maxSeq = Number(row?.max_seq ?? 0);
      if (Number(row?.count ?? 0) !== maxSeq) throw new Error("RUN_EVENT_SEQUENCE_CORRUPT");
      const next = maxSeq + 1;
      const statement = db.prepare(`INSERT INTO run_events (event_id,run_id,attempt_id,seq,schema_version,category,kind,occurred_at,source,correlation_json,payload_json) VALUES (:eventId,:runId,:attemptId,:seq,:schemaVersion,:category,:kind,:occurredAt,:source,:correlation,:payload)`);
      committed = events.map((candidate, index) => {
        const event = RunEventSchema.parse({ ...candidate, eventId: randomUUID(), seq: next + index });
        statement.run({ eventId: event.eventId, runId: event.runId, attemptId: event.attemptId ?? null, seq: event.seq, schemaVersion: event.schemaVersion, category: event.category, kind: event.kind, occurredAt: event.occurredAt, source: event.source, correlation: event.correlation ? JSON.stringify(event.correlation) : null, payload: JSON.stringify(event.payload) });
        return event;
      });
    });
    return committed;
  };
  return { append: (event) => appendMany([event])[0]!, appendMany, list(runId, afterSeq = 0) { const cursor = RunEventCursorSchema.parse({ runId, seq: afterSeq }); return db.prepare("SELECT * FROM run_events WHERE run_id=:runId AND seq>:after ORDER BY seq").all({ runId: cursor.runId, after: cursor.seq }).map(read); }, tail(runId) { const cursor = RunEventCursorSchema.parse({ runId, seq: 0 }); const seq = Number(db.prepare("SELECT COALESCE(max(seq),0) AS seq FROM run_events WHERE run_id=:runId").get({ runId: cursor.runId })?.seq ?? 0); return RunEventCursorSchema.parse({ runId: cursor.runId, seq }); } };
}

export function payloadDigest(event: RunEvent): string { return createHash("sha256").update(JSON.stringify(event.payload)).digest("hex"); }
