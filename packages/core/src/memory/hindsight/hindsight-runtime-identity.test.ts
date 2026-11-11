import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { applicationCommandTestInput } from "../../db/hindsight-application-command-fixtures.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { applicationCheckpointHash, readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { createHindsightRuntimeConnection } from "./hindsight-runtime-connection.ts";
import * as selection from "./template-lifecycle/template-runtime-selection.ts";

afterEach(() => vi.restoreAllMocks());
const triggerName = "memory_authority_selection_runtime_identity_update";

// Failure modes: stale warm evidence after SQL from either connection, disabled invalidation,
// transaction/schema ABA, and poisoned memo state after rollback or failed COMMIT.
it.each(["missing", "altered"])("refuses a %s invalidation trigger before writes or Native effects, and at full checks", async (damage) => {
  const f = hindsightRuntimeFixture(); const { state } = f.subsystem();
  const input = applicationCommandTestInput({ scope: f.banks[0]!.scope }); input.key.authorityEpochId = "epoch";
  try {
    state.runtime.assertConnection(); state.commands.prepare(input);
    const upload = vi.spyOn(f.remote.client, "uploadApplicationBody"); const commit = vi.spyOn(f.remote.client, "commitApplication");
    f.db.exec(`DROP TRIGGER ${triggerName}`);
    if (damage === "altered") f.db.exec(`CREATE TRIGGER ${triggerName} AFTER UPDATE ON memory_authority_selection BEGIN SELECT 1; END`);
    expect(() => state.runtime.assertConnection()).toThrow("MEMORY_RUNTIME_IDENTITY_SCHEMA_INVALID");
    expect(() => state.commands.prepare({ ...input, key: { ...input.key, requestId: "must-not-prepare" } })).toThrow();
    await expect(state.writer.run({ key: input.key, context: { timeoutMs: 10_000 } })).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT state FROM hindsight_application_command_jobs").all()).toEqual([{ state: "prepared" }]);
    expect(() => selection.readTemplateSelectionIdentity(f.db, "epoch")).toThrow("MEMORY_RUNTIME_IDENTITY_SCHEMA_INVALID");
    expect(() => createHindsightRuntimeConnection({ db: f.db, epochId: "epoch", config: f.source,
      secrets: f.secrets.catalog, client: f.remote.client })).toThrow("MEMORY_RUNTIME_IDENTITY_SCHEMA_INVALID");
    // Current control diagnosis remains independent of template/replica evidence validity.
    expect(state.runtime.observeStatus().drift).toBe("none");
  } finally { await f.close(); }
});

it("invalidates warm evidence for second-connection SQL, then accepts a valid restored state", async () => {
  const f = hindsightRuntimeFixture(); const { state } = f.subsystem();
  const external = openDatabase({ path: join(f.dataDir, "memory.sqlite"), migrations: [] });
  try {
    state.runtime.assertConnection(); const recompute = vi.spyOn(selection, "readCurrentRuntimeTemplateIdentity");
    state.runtime.assertConnection(); expect(recompute).not.toHaveBeenCalled();
    external.exec("UPDATE memory_authority_selection SET updated_at='identity-neutral change'");
    state.runtime.assertConnection(); expect(recompute).toHaveBeenCalledOnce();
    const saved = external.prepare("SELECT replica_checkpoint_digest FROM memory_authority_selection").get()!;
    external.exec("UPDATE memory_authority_selection SET replica_checkpoint_digest=printf('%064d',0)");
    expect(() => state.runtime.assertConnection()).toThrow("MEMORY_AUTHORITY_MISMATCH");
    external.prepare("UPDATE memory_authority_selection SET replica_checkpoint_digest=:digest").run({ digest: saved.replica_checkpoint_digest! });
    state.runtime.assertConnection();
  } finally { external.close(); await f.close(); }
});

it.each(["rollback", "savepoint", "commit failure"])("does not publish abandoned evidence after %s", async (kind) => {
  const f = hindsightRuntimeFixture(); const { state } = f.subsystem();
  try {
    f.db.exec("CREATE TABLE identity_parent(id INTEGER PRIMARY KEY); CREATE TABLE identity_child(id INTEGER REFERENCES identity_parent(id) DEFERRABLE INITIALLY DEFERRED)");
    const recompute = vi.spyOn(selection, "readCurrentRuntimeTemplateIdentity");
    const abandoned = () => {
      f.db.exec("UPDATE memory_authority_selection SET updated_at='abandoned'");
      state.runtime.assertConnection();
      if (kind === "commit failure") f.db.exec("INSERT INTO identity_child VALUES(123)");
      else throw new Error("abandon");
    };
    if (kind === "savepoint") f.db.transaction(() => { expect(() => f.db.transaction(abandoned)).toThrow("abandon"); });
    else expect(() => f.db.transaction(abandoned)).toThrow();
    recompute.mockClear();
    f.db.exec("UPDATE memory_authority_selection SET updated_at='different'");
    state.runtime.assertConnection(); expect(recompute).toHaveBeenCalledOnce();
    state.runtime.assertConnection(); expect(recompute).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it("does not reuse a transaction memo when trigger drop/write/recreate repeats an abandoned schema cookie", async () => {
  const f = hindsightRuntimeFixture(); const { state } = f.subsystem();
  try {
    const ddl = String(f.db.prepare("SELECT sql FROM sqlite_schema WHERE name=:name").get({ name: triggerName })?.sql);
    const recompute = vi.spyOn(selection, "readCurrentRuntimeTemplateIdentity");
    expect(() => f.db.transaction(() => {
      f.db.exec(`DROP TRIGGER ${triggerName}; ${ddl}`); state.runtime.assertConnection();
      throw new Error("rollback schema");
    })).toThrow("rollback schema");
    recompute.mockClear();
    f.db.transaction(() => {
      f.db.exec(`DROP TRIGGER ${triggerName}`);
      f.db.exec("UPDATE memory_authority_selection SET updated_at='untracked change'");
      f.db.exec(ddl); state.runtime.assertConnection();
    });
    expect(recompute).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it("refuses corrupt checkpoint evidence before writes after a dropped-trigger interval reuses a schema cookie", async () => {
  const f = hindsightRuntimeFixture(); const { state } = f.subsystem();
  const input = applicationCommandTestInput({ scope: f.banks[0]!.scope }); input.key.authorityEpochId = "epoch";
  const trigger = "hindsight_application_replica_checkpoints_runtime_identity_update";
  try {
    state.commands.prepare(input); state.runtime.assertConnection();
    const ddl = String(f.db.prepare("SELECT sql FROM sqlite_schema WHERE name=:name").get({ name: trigger })?.sql);
    const upload = vi.spyOn(f.remote.client, "uploadApplicationBody");
    expect(() => f.db.transaction(() => {
      f.db.exec(`DROP TRIGGER ${trigger}; ${ddl}`); state.runtime.assertConnection();
      throw new Error("abandon schema");
    })).toThrow("abandon schema");
    expect(() => f.db.transaction(() => {
      f.db.exec(`DROP TRIGGER ${trigger}`);
      f.db.exec("UPDATE hindsight_application_replica_checkpoints SET checkpoint_hash=printf('%064d',0)");
      f.db.exec(ddl);
      state.commands.prepare({ ...input, key: { ...input.key, requestId: "must-not-prepare" } });
    })).toThrow("HINDSIGHT_APPLICATION_CHECKPOINT_INVALID");
    expect(f.db.prepare("SELECT request_id FROM hindsight_application_command_jobs").all()).toEqual([{ request_id: input.key.requestId }]);
    expect(upload).not.toHaveBeenCalled(); state.runtime.assertConnection();
  } finally { await f.close(); }
});

it("recomputes once after legitimate checkpoint advancement and keeps the bound identity", async () => {
  const f = hindsightRuntimeFixture(); const { state } = f.subsystem();
  try {
    state.runtime.assertConnection(); const recompute = vi.spyOn(selection, "readCurrentRuntimeTemplateIdentity");
    const bankId = f.banks[0]!.scope.bankId; const prior = readApplicationCheckpoint(f.db, bankId)!;
    const next = { ...prior, checkpoint: { ...prior.checkpoint, state_cursor: prior.checkpoint.state_cursor + 1 } };
    f.db.prepare(`UPDATE hindsight_application_replica_checkpoints SET state_cursor=:cursor,checkpoint_json=:json,
      checkpoint_hash=:hash WHERE bank_id=:bank`).run({ bank: bankId, cursor: next.checkpoint.state_cursor,
      json: JSON.stringify(next), hash: applicationCheckpointHash(next) });
    state.runtime.assertConnection(); expect(recompute).toHaveBeenCalledOnce();
    state.runtime.assertConnection(); expect(recompute).toHaveBeenCalledOnce();
  } finally { await f.close(); }
});

it("reads a cold token inside direct SQL BEGIN without publishing an uncommitted memo", async () => {
  const f = hindsightRuntimeFixture(); const { state } = f.subsystem();
  try {
    state.runtime.assertConnection(); const recompute = vi.spyOn(selection, "readCurrentRuntimeTemplateIdentity");
    f.db.exec("BEGIN; UPDATE memory_authority_selection SET updated_at='direct transaction'");
    try { state.runtime.assertConnection(); expect(recompute).toHaveBeenCalledOnce(); }
    finally { f.db.exec("ROLLBACK"); }
    f.db.exec("UPDATE memory_authority_selection SET updated_at='committed state'");
    state.runtime.assertConnection(); expect(recompute).toHaveBeenCalledTimes(2);
    state.runtime.assertConnection(); expect(recompute).toHaveBeenCalledTimes(2);
  } finally { await f.close(); }
});
