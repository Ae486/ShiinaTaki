import { afterEach, describe, expect, it } from "vitest";
import { MemoryAuthorityStatusSchema } from "@taki/shared";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createLogger } from "../../logging/logger.ts";
import type { HindsightBindingSnapshot } from "../hindsight-runtime-binding.ts";
import type { HindsightLiveConnection } from "../hindsight/hindsight-runtime-connection.ts";
import { AT, CHARACTER, GLOBAL, fakeRuntime, fakeSetup, seedHindsightAuthority, type FakeRuntime } from "./memory-operation-fixtures.ts";
import { readMemoryAuthorityStatus } from "./memory-authority-status.ts";
import { createMemoryOperationService } from "./memory-operation-service.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

const READY: HindsightLiveConnection = { state: "ready", fingerprint: "a".repeat(64) };

function fixture(mode: "canonical-local" | "hindsight", runtime: FakeRuntime | null) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id='epoch',verified_snapshot_id='snapshot',activation_transaction_id='tx' WHERE singleton=1").run();
  if (mode === "hindsight") seedHindsightAuthority(db);
  else {
    db.prepare(`INSERT INTO canonical_memory_authority_epochs(epoch_id,provider_id,provider_lineage_id,status,started_at,reason)
      VALUES ('epoch','local','local-lineage','active',:now,'initial-local')`).run({ now: AT });
    db.prepare("INSERT INTO canonical_memory_authority_state VALUES (1,'epoch',:now)").run({ now: AT });
  }
  const setup = fakeSetup();
  const operations = createMemoryOperationService({ db, live: () => runtime, setup, bootId: "boot", now: () => AT, onChanged: () => undefined, logger: createLogger("fatal") });
  const connection = { live: READY };
  return { db, setup, operations, connection,
    read: () => readMemoryAuthorityStatus({ db, live: () => runtime, setup, operations, now: () => AT, liveConnection: () => connection.live }) };
}

describe("memory.authority.status read", () => {
  it("reports Local authority with null replica/pending evidence and the literal unknown freshness", () => {
    const f = fixture("canonical-local", null);
    const status = f.read();
    expect(MemoryAuthorityStatusSchema.parse(status)).toEqual(status);
    expect(status).toMatchObject({ authority: { mode: "canonical-local", epochId: "epoch", providerLineageId: null },
      runtime: { providerId: "local", available: true, unavailableReason: null }, replica: null, pending: null,
      operations: { active: [], recent: [] }, hindsight: null, derivedFreshness: "unknown", observedAt: AT, setup: { revision: 3 } });
  });

  it("reports per-Bank replica status and separate Pending/parent-write counts when the Hindsight runtime is live", async () => {
    const runtime = fakeRuntime([GLOBAL, CHARACTER], () => AT);
    const f = fixture("hindsight", runtime);
    const submitted = f.operations.submit({ kind: "replica.sync", bankId: "global", syncKind: "full" });
    await f.operations.stop();
    const status = f.read();
    expect(MemoryAuthorityStatusSchema.parse(status)).toEqual(status);
    expect(status.runtime).toEqual({ providerId: "hindsight", available: true, unavailableReason: null });
    expect(status.replica?.map((bank) => bank.bankId)).toEqual(["global", "character"]);
    expect(status.pending).toEqual([
      { bankId: "global", summary: expect.objectContaining({ pendingCount: 0, failedCount: 1, unknownCount: 2 }), parentWritesPending: 0 },
      { bankId: "character", summary: expect.objectContaining({ failedCount: 1 }), parentWritesPending: 0 },
    ]);
    expect(status.hindsight).toEqual({ connection: { config: "ready", drift: "none", admittedAt: null }, banks: [],
      actions: { revalidate: false, provision: [] }, backup: null });
    expect(status.operations.active).toEqual([]);
    expect(status.operations.recent.map((operation) => [operation.operationId, operation.state])).toEqual([[submitted.operationId, "completed"]]);
  });

  it("keeps the read successful with a closed reason when the runtime is unavailable or not installed", () => {
    const runtime = fakeRuntime([GLOBAL], () => AT);
    const f = fixture("hindsight", runtime);
    runtime.breakConnection("MEMORY_AUTHORITY_MISMATCH");
    expect(f.read()).toMatchObject({ runtime: { available: false, unavailableReason: "authority_mismatch" }, replica: null, pending: null });
    runtime.breakConnection("MEMORY_OPERATION_CANCELLED");
    expect(f.read().runtime.unavailableReason).toBe("stopped");
    runtime.breakConnection("HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE");
    expect(f.read().runtime.unavailableReason).toBe("connection_unavailable");
    expect(fixture("hindsight", null).read()).toMatchObject({ runtime: { providerId: "hindsight", available: false, unavailableReason: "not_installed" }, replica: null });
  });

  it("reports the Hindsight binding snapshot truthfully before the rebind, after it and once stopped", () => {
    const runtime = fakeRuntime([GLOBAL], () => AT);
    const f = fixture("hindsight", runtime);
    const snapshot = (binding: HindsightBindingSnapshot["binding"], lifetime: HindsightBindingSnapshot["lifetime"] = "running"): HindsightBindingSnapshot =>
      ({ selection: "hindsight", selectedEpochId: "epoch", binding, lifetime, flush: binding.kind === "published" && lifetime === "running" ? "available" : "failing" });
    const read = (binding: HindsightBindingSnapshot) => readMemoryAuthorityStatus({ db: f.db, live: () => runtime, hindsightBinding: () => binding,
      setup: f.setup, operations: f.operations, now: () => AT, liveConnection: () => READY });
    // Unavailable at construction but ready now: a revalidation rebinds it, so it is reported as a changed configuration.
    expect(read(snapshot({ kind: "unavailable", epochId: "epoch", code: "HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE" }))).toMatchObject({
      runtime: { providerId: "hindsight", available: false, unavailableReason: "config_changed" }, replica: null, pending: null });
    expect(read(snapshot({ kind: "unavailable", epochId: "epoch", code: "HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH" })).runtime.unavailableReason)
      .toBe("not_installed");
    expect(read(snapshot({ kind: "published", epochId: "other" })).runtime.unavailableReason).toBe("authority_mismatch");
    expect(read(snapshot({ kind: "published", epochId: "epoch" }, "stopped")).runtime.unavailableReason).toBe("stopped");
    const bound = read(snapshot({ kind: "published", epochId: "epoch" }));
    expect(MemoryAuthorityStatusSchema.parse(bound)).toEqual(bound);
    expect(bound).toMatchObject({ runtime: { available: true, unavailableReason: null } });
    expect(bound.replica?.map((bank) => bank.bankId)).toEqual(["global"]);
  });

  it("reports a changed or disabled connection as its own reason and keeps authority_mismatch for a real epoch mismatch", () => {
    const runtime = fakeRuntime([GLOBAL, CHARACTER], () => AT);
    const f = fixture("hindsight", runtime);
    runtime.drift("config_changed"); f.connection.live = { state: "ready", fingerprint: "c".repeat(64) };
    const changed = f.read();
    expect(MemoryAuthorityStatusSchema.parse(changed)).toEqual(changed);
    expect(changed).toMatchObject({ runtime: { available: false, unavailableReason: "config_changed" }, replica: null, pending: null,
      hindsight: { connection: { config: "ready", drift: "config_changed", admittedAt: null } } });
    runtime.drift("connection_disabled"); f.connection.live = { state: "disabled", fingerprint: null };
    expect(f.read()).toMatchObject({ runtime: { unavailableReason: "connection_disabled" },
      hindsight: { connection: { config: "disabled", drift: "none", admittedAt: null } } });
    runtime.drift("none"); runtime.breakConnection("MEMORY_AUTHORITY_MISMATCH");
    expect(f.read().runtime.unavailableReason).toBe("authority_mismatch");
  });

  it("reports a setting-caused unbound runtime as that setting and every other unbound state as not_installed", () => {
    const f = fixture("hindsight", null);
    const unavailable = (code: string): HindsightBindingSnapshot => ({ selection: "hindsight", selectedEpochId: "epoch",
      binding: { kind: "unavailable", epochId: "epoch", code }, lifetime: "running", flush: "failing" });
    const read = (binding: HindsightBindingSnapshot) => readMemoryAuthorityStatus({ db: f.db, live: () => null, hindsightBinding: () => binding,
      setup: f.setup, operations: f.operations, now: () => AT, liveConnection: () => f.connection.live });
    for (const state of ["disabled", "unconfigured"] as const) {
      f.connection.live = { state, fingerprint: null };
      expect(read(unavailable("HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE"))).toMatchObject({
        runtime: { available: false, unavailableReason: "connection_disabled" }, hindsight: { connection: { config: state } } });
    }
    f.connection.live = READY;
    expect(read(unavailable("HINDSIGHT_TEMPLATE_CONFLICT")).runtime).toMatchObject({ available: false, unavailableReason: "config_changed" });
    expect(read(unavailable("MEMORY_INTEGRITY_ERROR")).runtime.unavailableReason).toBe("not_installed");
    expect(read({ ...unavailable("HINDSIGHT_TEMPLATE_CONFLICT"), binding: { kind: "unavailable", epochId: "other", code: "HINDSIGHT_TEMPLATE_CONFLICT" } })
      .runtime.unavailableReason).toBe("not_installed");
    f.connection.live = { state: "disabled", fingerprint: null };
    expect(read(unavailable("MEMORY_INTEGRITY_ERROR")).runtime.unavailableReason).toBe("not_installed");
    expect(read({ ...unavailable("HINDSIGHT_TEMPLATE_CONFLICT"), lifetime: "stopped" }).runtime.unavailableReason).toBe("stopped");
  });

  it("answers with an unconfigured connection when the live config or Secret Catalog cannot be read", () => {
    const f = fixture("hindsight", null);
    const status = readMemoryAuthorityStatus({ db: f.db, live: () => null, setup: f.setup, operations: f.operations, now: () => AT,
      liveConnection: () => { throw new Error("CONFIG_UNREADABLE"); } });
    expect(MemoryAuthorityStatusSchema.parse(status)).toEqual(status);
    expect(status).toMatchObject({ runtime: { available: false, unavailableReason: "not_installed" },
      hindsight: { connection: { config: "unconfigured", drift: "none", admittedAt: null }, actions: { revalidate: false, provision: [] } } });
  });
});
