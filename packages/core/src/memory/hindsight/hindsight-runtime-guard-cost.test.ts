import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as shared from "@taki/shared";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import * as checkpoints from "../../db/hindsight-application-replica-checkpoint.ts";
import * as selections from "./template-lifecycle/template-runtime-selection.ts";
import { curatorTestBank, curatorTestReport } from "./hindsight-policy-curator-fixtures.ts";
import { loadHindsightPolicyConfig } from "../../config/hindsight-policy-config.ts";
import { createHindsightPolicyWorkRepo } from "../../db/hindsight-policy-work-repo.ts";
import { createHindsightPolicyCurator } from "./hindsight-policy-curator.ts";
import { captureHindsightRuntimeRows } from "./hindsight-runtime-view.ts";
import { openDatabase } from "../../db/sqlite.ts";

afterEach(() => vi.restoreAllMocks());

const counts = () => ({ identity: vi.spyOn(selections, "readCurrentRuntimeTemplateIdentity"),
  checkpoint: vi.spyOn(checkpoints, "readApplicationCheckpoint"), decode: vi.spyOn(shared, "parseTakiApplicationBody") });
const clear = (spies: ReturnType<typeof counts>) => { spies.identity.mockClear(); spies.checkpoint.mockClear(); spies.decode.mockClear(); };
const metrics = (spies: ReturnType<typeof counts>) => ({ identity: spies.identity.mock.calls.length,
  checkpoint: spies.checkpoint.mock.calls.length, decode: spies.decode.mock.calls.length });
const bank = (count: number) => curatorTestBank({ memories: Array.from({ length: count }, (_, index) => ({ id: `memory-${index}` })) });

it("reuses committed trigger verification while the schema is unchanged", async () => {
  const f = hindsightRuntimeFixture();
  const external = openDatabase({ path: join(f.dataDir, "memory.sqlite"), migrations: [] });
  const prepare = f.db.prepare.bind(f.db); const comparisons = vi.fn();
  vi.spyOn(f.db, "prepare").mockImplementation((sql) => {
    const statement = prepare(sql);
    if (!sql.includes("sqlite_schema") || !sql.includes("runtime_identity")) return statement;
    return { ...statement, get: (params) => { comparisons(); return statement.get(params); } };
  });
  try {
    const { state } = f.subsystem(); state.runtime.assertConnection();
    expect(comparisons).toHaveBeenCalled(); comparisons.mockClear();
    for (let call = 0; call < 3; call++) state.runtime.assertConnection();
    f.db.transaction(() => { state.runtime.assertConnection(); state.runtime.assertConnection(); });
    // Data changes invalidate template evidence, but do not change trigger definitions.
    f.db.exec("UPDATE memory_authority_selection SET updated_at='cost-check'");
    state.runtime.assertConnection();
    expect(comparisons).not.toHaveBeenCalled();

    external.exec("CREATE TABLE identity_cost_probe(id INTEGER)");
    state.runtime.assertConnection(); state.runtime.assertConnection();
    expect(comparisons).toHaveBeenCalledOnce(); comparisons.mockClear();
    expect(() => f.db.transaction(() => {
      f.db.exec("CREATE TABLE abandoned_identity_cost_probe(id INTEGER)");
      state.runtime.assertConnection(); comparisons.mockClear();
      state.runtime.assertConnection();
      expect(comparisons).toHaveBeenCalled();
      throw new Error("abandon schema verification");
    })).toThrow("abandon schema verification");
    comparisons.mockClear(); state.runtime.assertConnection();
    expect(comparisons).not.toHaveBeenCalled();
  } finally { external.close(); await f.close(); }
});

it.each([1, 16])("captures %i chat rows with constant identity recomputation and one parse per body", async (count) => {
  const global = bank(count);
  const f = hindsightRuntimeFixture({ banks: [global, curatorTestBank({ bankId: "bank-taki", characterId: "taki", memories: [] })] });
  try {
    const subsystem = f.subsystem(); const spies = counts();
    subsystem.state.runtime.assertConnection();
    expect(spies.identity.mock.calls.length).toBeLessThanOrEqual(1);
    for (let request = 0; request < 2; request++) {
      clear(spies);
      expect(captureHindsightRuntimeRows(subsystem.state, { characterId: "taki", intentions: false })).toHaveLength(count);
      expect(metrics(spies)).toEqual({ identity: 0, checkpoint: 2, decode: 2 * count + 4 });
    }
  } finally { await f.close(); }
});

it("keeps warm native recall guard cost independent of candidate count and reuses exact published bytes", async () => {
  const observed = [];
  for (const count of [1, 16]) {
    const f = hindsightRuntimeFixture({ banks: [bank(count), curatorTestBank({ bankId: "bank-taki", characterId: "taki", memories: [] })] });
    try {
      const subsystem = f.subsystem(); await subsystem.state.provider.capabilities();
      const spies = counts(); clear(spies); f.remote.calls.length = 0;
      const result = await subsystem.state.provider.recall({ requestId: "cost-recall", authorityEpochId: "epoch", actor: "foreground-agent" },
        { bankId: "bank-a", query: "fact", queryTimestamp: null, limit: 32, maxTokens: 16_384,
          factTypes: ["world", "experience", "observation"], layerIds: [], includeInvalidated: false, budget: "low" });
      expect(result).toMatchObject({ ok: true, data: { returned: count, partial: false } });
      const value = metrics(spies); observed.push(value);
      expect(f.remote.calls.filter((call) => call.operation === "body" || call.operation === "body-part")).toEqual([]);
      expect(f.remote.calls.filter((call) => call.operation === "hydrate")).toHaveLength(1);
      expect(f.remote.calls.filter((call) => call.operation === "snapshot-page")).toHaveLength(1);
      vi.restoreAllMocks();
    } finally { await f.close(); }
  }
  expect(observed[1]!.identity).toBe(observed[0]!.identity);
  expect(observed[1]!.checkpoint).toBe(observed[0]!.checkpoint);
  // The local reader and the two independent bundle proof boundaries each decode new distinct bodies once.
  expect(observed[1]!.decode - observed[0]!.decode).toBe(3 * 2 * 15);
});

it.each([1, 16])("validates a %i-target curator submission with fixed checkpoint checks and unique body decoding", async (count) => {
  const global = bank(count); let checked = false;
  const f = hindsightRuntimeFixture({ banks: [global, curatorTestBank({ bankId: "bank-taki", characterId: "taki", memories: [] })] });
  const subsystem = f.subsystem(); const { state } = subsystem;
  const work = createHindsightPolicyWorkRepo({ db: f.db, assertActive: (scope) => state.assertActive({
    key: { authorityEpochId: scope.authorityEpochId, bankId: scope.bankId, requestId: "policy-work" }, namespace: scope.namespace }) });
  state.config.reportClassCap = count;
  state.runtime.assertConnection();
  // Keep the dependency set unchanged for this cost contract. A connected pass publishes
  // failed assessments from this no-proposals driver and legitimately advances checkpoints.
  f.remote.control.offline = true;
  const stamp = () => f.db.prepare("SELECT hex(stamp) AS stamp FROM hindsight_runtime_identity_clock").get()?.stamp;
  const originalStamp = stamp();
  const spies = counts(); clear(spies);
  const curator = createHindsightPolicyCurator({ replica: state.replica, work, writer: state.writer, authority: state.runtime.authority,
    slot: subsystem.utility, resolveBanks: state.runtime.resolveBanks, readBlock: state.blocks.read,
    refreshBank: (bankId, context) => state.service.synchronize({ bankId, context }),
    config: () => ({ memory: state.config, policy: loadHindsightPolicyConfig({}) }), driver: async (input) => {
    expect(curatorTestReport(input).policies).toHaveLength(count);
    const before = metrics(spies);
    input.assertInput();
    const after = metrics(spies);
    expect({ identity: after.identity - before.identity, checkpoint: after.checkpoint - before.checkpoint,
      decode: after.decode - before.decode }).toEqual({ identity: 0, checkpoint: 1, decode: 2 * count + 2 });
    checked = true;
    return { steps: 1, usage: { inputTokens: 0, outputTokens: 0 } };
  } });
  try {
    const outcome = await curator.runNow("taki"); expect(checked).toBe(true);
    expect(outcome.status).toBe("failed"); expect(outcome.pending).toBeGreaterThanOrEqual(count);
    expect(stamp()).toBe(originalStamp);
    // Journal prepare/claim/prompt writes do not change the current identity dependencies.
    expect(spies.identity).not.toHaveBeenCalled();
  }
  finally { await curator.stop(); await f.close(); }
});
