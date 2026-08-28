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
