import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunEvent } from "@taki/shared";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { createRunEventRepo } from "./run-event-repo.ts";
import { openDatabase, type Database } from "./sqlite.ts";
const dbs: Database[] = [];
const roots: string[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const base = (kind: RunEvent["kind"]): Omit<RunEvent, "eventId" | "seq"> => ({ runId: "r", schemaVersion: "run-event.v1", category: "lifecycle", kind, occurredAt: "2026-08-24T00:00:00.000Z", source: "core.run-repo", payload: kind === "run.started" ? { kind, state: "running", operationPhase: "executing" } : { kind: "run.admitted", state: "queued", initiator: "primary", deliveryClass: "class_a", attemptOrdinal: 1 } });

function emptyRun() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  db.exec("INSERT INTO run_snapshots(snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('s','r','v1','{}','d','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'); INSERT INTO runs(run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,snapshot_id,queued_at,operation_phase,created_at,updated_at) VALUES ('r','c','t','i','h','primary','{}','class_a','queued','s','2026-08-24T00:00:00.000Z','admitted','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');");
  return { db, repo: createRunEventRepo(db) };
}

describe("bounded event pages", () => {
  it.each([0, 1, 200, 201])("returns chronological forward and tail pages across the %i-record edge", (count) => {
    const { repo } = emptyRun();
    repo.appendMany(Array.from({ length: count }, () => base("run.started")));
    const forward = repo.page({ runId: "r", limit: 200 });
    const tail = repo.page({ runId: "r", tail: true, limit: 200 });
    expect(forward.events.map((event) => event.seq)).toEqual(Array.from({ length: Math.min(count, 200) }, (_, index) => index + 1));
    expect(forward.hasMore).toBe(count > 200);
    expect(tail.events.map((event) => event.seq)).toEqual(Array.from({ length: Math.min(count, 200) }, (_, index) => Math.max(1, count - 199) + index));
    expect(tail.hasOlder).toBe(count > 200);
    expect(tail.hasMore).toBe(false);
    expect(repo.page({ runId: "r", beforeSeq: 1, limit: 1 })).toMatchObject({ events: [], hasOlder: false, cursor: 0 });
  });

  it("uses exclusive before pages while newly appended records keep an independent forward tail", () => {
    const { repo } = emptyRun();
    repo.appendMany(Array.from({ length: 201 }, () => base("run.started")));
    const tail = repo.page({ runId: "r", tail: true, limit: 100 });
    repo.appendMany(Array.from({ length: 10 }, () => base("run.started")));
    const older = repo.page({ runId: "r", beforeSeq: tail.olderSeq, limit: 100 });
    const live = repo.page({ runId: "r", afterSeq: tail.cursor, limit: 100 });
    expect(older.events[0]?.seq).toBe(2);
    expect(older.events.at(-1)?.seq).toBe(101);
    expect(live.events.map((event) => event.seq)).toEqual([202, 203, 204, 205, 206, 207, 208, 209, 210, 211]);
    expect(() => repo.page({ runId: "r", beforeSeq: 213, limit: 1 })).toThrow("OBSERVABILITY_CURSOR_STALE");
    expect(() => repo.page({ runId: "r", afterSeq: 212, limit: 1 })).toThrow("OBSERVABILITY_CURSOR_STALE");
    expect(repo.get("r", tail.events[0]!.eventId)).toEqual(tail.events[0]);
    expect(repo.get("other", tail.events[0]!.eventId)).toBeUndefined();
  });
});
describe("RunEventRepo", () => { it("assigns contiguous immutable sequences and validates reads", () => { const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db); db.exec("INSERT INTO run_snapshots(snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('s','r','v1','{}','d','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'); INSERT INTO runs(run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,snapshot_id,queued_at,operation_phase,created_at,updated_at) VALUES ('r','c','t','i','h','primary','{}','class_a','queued','s','2026-08-24T00:00:00.000Z','admitted','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');"); const repo = createRunEventRepo(db); const first = repo.append(base("run.admitted")); const second = repo.append(base("run.started")); expect([first.seq, second.seq]).toEqual([1, 2]); expect(repo.list("r").map((e) => e.seq)).toEqual([1, 2]); expect(repo.tail("r")).toEqual({ runId: "r", seq: 2 }); }); });

it("rejects direct mutation of committed Run events", () => {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  db.exec("INSERT INTO run_snapshots(snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('s','r','v1','{}','d','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'); INSERT INTO runs(run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,snapshot_id,queued_at,operation_phase,created_at,updated_at) VALUES ('r','c','t','i','h','primary','{}','class_a','queued','s','2026-08-24T00:00:00.000Z','admitted','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');");
  const event = createRunEventRepo(db).append(base("run.admitted"));
  expect(() => db.prepare("UPDATE run_events SET source='x' WHERE event_id=:id").run({ id: event.eventId })).toThrow(/RUN_EVENT_IMMUTABLE/);
  expect(() => db.prepare("DELETE FROM run_events WHERE event_id=:id").run({ id: event.eventId })).toThrow(/RUN_EVENT_IMMUTABLE/);
});

it("replays identical observability events after a database restart", () => {
  const root = mkdtempSync(join(tmpdir(), "taki-run-event-replay-")); roots.push(root);
  const path = join(root, "taki.db");
  const first = openDatabase({ path, migrations: MIGRATIONS });
  first.exec("INSERT INTO run_snapshots(snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('s','r','v1','{}','d','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'); INSERT INTO runs(run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at) VALUES ('r','c','t','i','h','primary','{}','class_a','running','s','a','2026-08-24T00:00:00.000Z','executing','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z'); INSERT INTO run_attempts(attempt_id,run_id,ordinal,state,provider,model_id,snapshot_id) VALUES ('a','r',1,'effect_running','p','m','s');");
  const repo = createRunEventRepo(first);
  repo.appendMany([
    base("run.admitted"),
    { runId: "r", attemptId: "a", schemaVersion: "run-event.v1", category: "model", kind: "model.request.started", occurredAt: "2026-08-24T00:00:00.100Z", source: "core.model-observer", payload: { kind: "model.request.started", state: "running", effectId: "effect", callId: "call", provider: "p", modelId: "m", startedAt: "2026-08-24T00:00:00.100Z" } },
  ]);
  const before = repo.list("r");
  first.close();
  const reopened = openDatabase({ path, migrations: MIGRATIONS }); dbs.push(reopened);
  expect(createRunEventRepo(reopened).list("r")).toEqual(before);
});
