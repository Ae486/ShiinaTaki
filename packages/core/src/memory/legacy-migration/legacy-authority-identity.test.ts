import { afterEach, describe, expect, it } from "vitest";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { readCurrentMemoryAuthorityIdentity } from "./legacy-activation-repo.ts";
import { cleanupLegacyMigrationFixtures, createLegacyMigrationFixture } from "./legacy-migration-fixture.ts";

afterEach(cleanupLegacyMigrationFixtures);

describe("current authority control identity", () => {
  it("allows Legacy selection alongside a prepared canonical epoch and preserves the initial B2 marker shape", async () => {
    const f = createLegacyMigrationFixture();
    const legacy = readCurrentMemoryAuthorityIdentity(f.db);
    expect(legacy).toEqual({ mode: "legacy-markdown", epochId: null, snapshotId: null, transactionId: null,
      providerLineageId: null, replicaCheckpointDigest: null, activeProviderId: null, activeProviderLineageId: null });
    await f.prepare();
    expect(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_authority_epochs").get()?.n).toBeGreaterThan(0);
    expect(readCurrentMemoryAuthorityIdentity(f.db)).toEqual(legacy);
    await f.activate("run-1");
    const active = createCanonicalMemoryAuthorityRepo(f.db).authorityEpoch();
    expect(readCurrentMemoryAuthorityIdentity(f.db)).toEqual({ mode: "canonical-local", epochId: active.epochId,
      snapshotId: expect.any(String), transactionId: "tx-run-1", providerLineageId: null, replicaCheckpointDigest: null,
      activeProviderId: "local", activeProviderLineageId: active.providerLineageId });
  });
});
