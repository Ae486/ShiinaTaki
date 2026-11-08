import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMemoryConfig } from "../../config/memory-config.ts";
import { createConfigSource } from "../../config/config-source.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import * as authority from "../legacy-migration/legacy-activation-repo.ts";
import { APPLICATION_TEST_AT } from "../../testing/hindsight-application-fixtures.ts";
import { hindsightFixtureSecrets, hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { curatorTestBank } from "./hindsight-policy-curator-fixtures.ts";
import { createHindsightRuntimeConnection } from "./hindsight-runtime-connection.ts";
import { createHindsightRuntimeState } from "./hindsight-runtime-state.ts";
import { captureHindsightRuntimeRows } from "./hindsight-runtime-view.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function countSelections() {
  return vi.spyOn(authority, "readCurrentMemoryAuthorityIdentity");
}

describe("synchronous Hindsight runtime row snapshots", () => {
  it.each([1, 16])("uses one current identity guard for %i records and keeps every read inside the snapshot", async (count) => {
    const bank = curatorTestBank({ memories: Array.from({ length: count }, (_, i) => ({ id: `fact-${i}` })) });
    const f = hindsightRuntimeFixture({ banks: [bank, curatorTestBank({ bankId: "bank-taki", characterId: "taki", memories: [] })] });
    const selected = countSelections(); const subsystem = f.subsystem();
    const originalTransaction = f.db.transaction; const originalPrepare = f.db.prepare;
    let depth = 0; const outside: string[] = [];
    const transaction = vi.spyOn(f.db, "transaction").mockImplementation((fn) => originalTransaction(() => {
      depth++; try { fn(); } finally { depth--; }
    }));
    const prepare = vi.spyOn(f.db, "prepare").mockImplementation((sql) => {
      if (!depth) outside.push(sql); return originalPrepare(sql);
    });
    try {
      selected.mockClear();
      const rows = captureHindsightRuntimeRows(subsystem.state, { characterId: "taki", intentions: false });
      expect(rows).toHaveLength(count);
      expect(rows.map((row) => row.content)).toEqual(bank.native.slice(1).map((entry) => {
        if (entry.body.content.body_schema !== "application-native-record.v1"
          || !("text" in entry.body.content.value.payload)) throw new Error("fixture memory missing");
        return entry.body.content.value.payload.text;
      }).sort());
      expect(selected).toHaveBeenCalledTimes(1);
      expect(outside).toEqual([]);
      expect(depth).toBe(0);
      rows[0]!.content = "caller mutation";
      selected.mockClear();
      const next = captureHindsightRuntimeRows(subsystem.state, { characterId: "taki", intentions: false });
      expect(next[0]!.content).not.toBe("caller mutation");
      expect(selected).toHaveBeenCalledTimes(1);
      expect(outside).toEqual([]);
    } finally { prepare.mockRestore(); transaction.mockRestore(); await f.close(); }
  });

  it("retains exact Global/Character policy admission and rechecks current row evidence", async () => {
    const global = curatorTestBank({ memories: [
      { id: "visible", text: "Global fact" },
      { id: "pinned", text: "Required pin", policy: { layerId: "profile", importance: 9, visibility: "pinned" } },
      { id: "hidden", text: "Hidden fact", policy: { visibility: "hidden" } },
      { id: "expired", text: "Expired fact", policy: { retention: { kind: "expiring", expiresAt: APPLICATION_TEST_AT } } },
      { id: "invalid", text: "Invalid fact", invalidated: true },
    ] });
    const character = curatorTestBank({ bankId: "bank-taki", characterId: "taki", memories: [
      { id: "intention", text: "Character intention", policy: { layerId: "intentions", visibility: "mood-gated", disclosure: "coffee" } },
      { id: "visible", text: "Character fact" },
    ] });
    const f = hindsightRuntimeFixture({ banks: [global, character] }); const subsystem = f.subsystem();
    const capture = (intentions = false) => captureHindsightRuntimeRows(subsystem.state, { characterId: "taki", intentions });
    try {
      expect(capture().map(({ content, characterId }) => ({ content, characterId }))).toEqual([
        { content: "Required pin", characterId: null }, { content: "Global fact", characterId: null },
        { content: "Character fact", characterId: "taki" },
      ]);
      expect(capture(true).map((row) => row.content)).toEqual(["Required pin", "Global fact", "Character intention", "Character fact"]);
      for (const damage of ["projection", "head", "body"] as const) {
        const rollback = new Error("restore current row evidence");
        expect(() => f.db.transaction(() => {
          if (damage === "projection") f.db.prepare("UPDATE hindsight_application_replica_projections SET bytes_sha256=:hash WHERE object_kind='memory_unit' AND object_id='visible'")
            .run({ hash: "0".repeat(64) });
          if (damage === "head") f.db.exec("UPDATE hindsight_application_replica_heads SET head_bytes=x'7b7d' WHERE object_kind='memory_unit'");
          if (damage === "body") f.db.exec("UPDATE hindsight_application_replica_bodies SET body_bytes=zeroblob(total_bytes) WHERE body_schema='application-memory.v1'");
          expect(capture).toThrow(new Error(damage === "body" ? "HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR" : "HINDSIGHT_APPLICATION_REPLICA_INTEGRITY_ERROR"));
          throw rollback;
        })).toThrow(rollback);
        expect(capture()).toHaveLength(3);
      }
    } finally { await f.close(); }
  });

  it("revalidates completed REENTRY current identity, connection and routing on every capture", async () => {
    const f = await createHealthyTransitionHarness();
    for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
      const operation = f.owner.submit(await f.request(undefined, kind)); await f.owner.stop();
      expect(f.owner.status(operation.operationId).state).toBe("completed");
    }
    await f.runtime.stop();
    const epochId = readMemoryAuthoritySelection(f.db).epochId!;
    const config = createConfigRepo(f.db); config.upsert("TAKI_HINDSIGHT_ENABLED", true);
    config.upsert("TAKI_HINDSIGHT_ENDPOINT", "http://127.0.0.1:18481");
    const selected = countSelections();
    const runtime = createHindsightRuntimeConnection({ db: f.db, epochId, config: createConfigSource({ repo: config, env: {} }),
      secrets: hindsightFixtureSecrets().catalog, client: f.remote.client });
    const state = createHindsightRuntimeState({ db: f.db, runtime, config: loadMemoryConfig({}), now: () => W3_AT });
    const capture = () => captureHindsightRuntimeRows(state, { characterId: "taki", intentions: false });
    try {
      selected.mockClear(); const initial = capture();
      expect(initial.map(({ content, characterId }) => ({ content, characterId }))).toEqual([
        { content: "A fixture memory survives the publication.", characterId: null },
        { content: "A fixture memory survives the publication.", characterId: "taki" },
      ]);
      expect(selected).toHaveBeenCalledTimes(1);
      for (const damage of ["marker", "checkpoint", "config", "route"] as const) {
        const rollback = new Error("restore row snapshot fixture");
        expect(() => f.db.transaction(() => {
          if (damage === "marker") f.db.prepare("UPDATE memory_authority_selection SET replica_checkpoint_digest=:hash").run({ hash: "0".repeat(64) });
          if (damage === "checkpoint") f.db.prepare("UPDATE hindsight_application_replica_checkpoints SET checkpoint_hash=:hash").run({ hash: "0".repeat(64) });
          if (damage === "config") config.upsert("TAKI_HINDSIGHT_ENABLED", false);
          if (damage === "route") f.db.prepare("UPDATE hindsight_bank_setup SET status='pending' WHERE scope_kind='character'").run();
          const code = damage === "checkpoint" ? "HINDSIGHT_APPLICATION_CHECKPOINT_INVALID"
            : damage === "config" ? "MEMORY_AUTHORITY_MISMATCH" : damage === "route" ? "HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH"
              : "MEMORY_AUTHORITY_MISMATCH";
          expect(capture).toThrow(new Error(code)); throw rollback;
        })).toThrow(rollback);
        selected.mockClear(); expect(capture()).toEqual(initial); expect(selected).toHaveBeenCalledTimes(1);
      }
      runtime.stop(); expect(capture).toThrow(new Error("MEMORY_OPERATION_CANCELLED"));
    } finally {
      runtime.stop(); state.sync.stop();
      await Promise.allSettled([state.service.stop(), state.writer.stop(), state.writes.stop(), state.provider.stop(), state.sync.settle()]);
      await f.close();
    }
  }, 30_000);
});
