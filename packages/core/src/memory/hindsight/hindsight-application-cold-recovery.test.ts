import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { APPLICATION_TEST_AT } from "../../testing/hindsight-application-fixtures.ts";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { createConfigSource } from "../../config/config-source.ts";
import { loadMemoryConfig } from "../../config/memory-config.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";
import { createUtilitySlot } from "../utility-slot.ts";
import { createHindsightMemorySubsystem } from "./hindsight-memory-subsystem.ts";
import { curatorTestBank } from "./hindsight-policy-curator-fixtures.ts";

const fixtures: HindsightRuntimeFixture[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(APPLICATION_TEST_AT); });
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
  vi.restoreAllMocks(); vi.useRealTimers();
});

describe("D77 bounded cold-read recovery", () => {
  it("resumes verified body downloads after SQLite reopen without publishing incomplete state", async () => {
    const bank = curatorTestBank({ memories: Array.from({ length: 7 }, (_, index) => ({ id: `memory-${index}` })) });
    const f = hindsightRuntimeFixture({ seed: false, banks: [bank] }); fixtures.push(f);
    f.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 250);
    const firstSubsystem = f.subsystem();
    let requests = 0;
    const body = f.remote.client.applicationBody; const part = f.remote.client.applicationBodyPart;
    const pause = async () => { requests++; await new Promise((resolve) => setTimeout(resolve, 60)); };
    vi.spyOn(f.remote.client, "applicationBody").mockImplementation(async (input) => { await pause(); return body(input); });
    vi.spyOn(f.remote.client, "applicationBodyPart").mockImplementation(async (input) => { await pause(); return part(input); });
    const first = firstSubsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 170 } })
      .then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await first).toMatchObject({ message: "HINDSIGHT_DEADLINE_EXCEEDED" });
    expect(f.replica.checkpoint(bank.scope.bankId)).toBeUndefined();
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_application_replica_heads").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_application_replica_projections").get()?.n).toBe(0);
    expect(() => f.replica.body({ ...bank.scope, bodyId: bank.artifacts[0]!.body.ref.body_id }))
      .toThrow("HINDSIGHT_APPLICATION_CHECKPOINT_MISSING");
    const firstRequests = requests;
    await firstSubsystem.stop(); f.db.close();
    const db = openDatabase({ path: join(f.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
    const utility = createUtilitySlot({ mainModel: f.model, logger: f.logger });
    const recovered = createHindsightMemorySubsystem({ db, epochId: "epoch", config: loadMemoryConfig({}),
      source: createConfigSource({ env: {}, repo: createConfigRepo(db) }), secrets: f.secrets.catalog,
      timeline: createTimelineRepo(db), utility, logger: f.logger, client: f.remote.client });
    try {
      const second = recovered.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 170 } })
        .then(() => null, (error: unknown) => error);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await second).toBeNull();
      expect(requests - firstRequests).toBeLessThan(firstRequests);
      expect(recovered.state.replica.checkpoint(bank.scope.bankId)).toBeDefined();
      expect(recovered.state.replica.search({ ...bank.scope, query: "fact", limit: 20 })).toHaveLength(7);
    } finally { await recovered.stop(); await utility.stop(); db.close(); }
  });
});
