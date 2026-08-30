import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { MIGRATIONS } from "./index-list.ts";
import { conversationCompactionLifecycleMigration032 } from "./032-conversation-compaction-lifecycle.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function historical(): Database {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.slice(0, 31) });
  dbs.push(db);
  return db;
}

describe("migration 032 — durable conversation compaction lifecycle", () => {
  it("upgrades an existing summary with a revisioned, source-aware checkpoint", () => {
    const db = historical();
    db.prepare("INSERT INTO conversation_summary (character_id,through_seq,text,updated_at) VALUES ('taki',12,'old','t')").run();

    expect(runMigrations(db, [conversationCompactionLifecycleMigration032])).toEqual([32]);

    expect(db.prepare(`SELECT through_seq,text,revision,last_operation_id,source_digest
      FROM conversation_summary WHERE character_id='taki'`).get()).toEqual({
      through_seq: 12,
      text: "old",
      revision: 1,
      last_operation_id: null,
      source_digest: null,
    });
  });

  it("creates a strict per-Character lock cursor and immutable event ledger", () => {
    const db = historical();
    runMigrations(db, [conversationCompactionLifecycleMigration032]);
    const digest = "a".repeat(64);
    const insert = `INSERT INTO conversation_compaction_operations
      (operation_id,character_id,reason,state,attempt_no,selected_from_seq,selected_through_seq,captured_tail_seq,
       expected_summary_revision,expected_summary_through,source_digest,before_tokens,provider,model_id,
       lease_owner,lease_fence,lease_expires_at,started_at,updated_at)
      VALUES ('op','taki','pressure','open',1,1,6,10,0,0,'${digest}',90,'provider','model','owner',1,
       '2026-08-30T00:10:00.000Z','2026-08-30T00:00:00.000Z','2026-08-30T00:00:00.000Z')`;
    db.exec(insert);

    expect(() => db.exec(insert.replace("'op'", "'op-2'"))).toThrow();
    expect(() => db.exec(insert.replace("'op'", "'op-gap'").replace("'open',1,1,6,10,0,0", "'open',1,2,6,10,0,0")))
      .toThrow();
    expect(() => db.prepare("UPDATE conversation_compaction_operations SET before_tokens='many' WHERE operation_id='op'").run())
      .toThrow();

    db.prepare(`INSERT INTO conversation_compaction_events
      (operation_id,operation_seq,character_id,attempt_no,kind,occurred_at,selected_through,before_tokens,
       lease_fence,provider,model_id) VALUES ('op',1,'taki',1,'started','2026-08-30T00:00:00.000Z',6,90,1,'provider','model')`).run();
    expect(() => db.prepare("UPDATE conversation_compaction_events SET kind='failed' WHERE operation_id='op'").run())
      .toThrow("append-only");
    expect(() => db.prepare("DELETE FROM conversation_compaction_events WHERE operation_id='op'").run())
      .toThrow("append-only");
  });
});
