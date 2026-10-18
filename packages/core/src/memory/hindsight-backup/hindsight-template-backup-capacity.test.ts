import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { templateBackupConsumerFixture } from "../../testing/hindsight-template-backup-consumer-fixture.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { readApplicationCheckpoint, applicationCheckpointHash } from "../../db/hindsight-application-replica-checkpoint.ts";
import { publishReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { hindsightBankBindings } from "../hindsight/hindsight-bank-identity.ts";
import { readHealthyTransitionIdentity } from "../transitions/transition-current-identity.ts";
import type { Database } from "../../db/sqlite.ts";

// Exact typed checkpoints are sufficient for these two admission producers. This
// does not claim full 1024-Bank W2 transfer or allocate the request byte ceiling.
function addBanks(db: Database, total: number) {
  const repo = createHindsightBankSetupRepo(db); const rows = repo.list();
  const source = rows.find((row) => row.scope === "character")!;
  const original = readApplicationCheckpoint(db, source.externalBankId)!;
  db.transaction(() => {
    for (let index = rows.length; index < total; index++) {
      const characterId = `capacity-character-${index}`;
      const bankId = hindsightBankBindings(characterId)[1].externalBankId;
      const generation = randomUUID();
      repo.upsert({ ...source, canonicalIdentity: `character:${characterId}`, externalBankId: bankId });
      const next = { ...original, bankId, bankScope: { kind: "character" as const, characterId },
        namespace: { ...original.namespace, bank_generation: generation },
        native: { ...original.native, bankId, bankGeneration: generation, replicaEpochId: randomUUID() } };
      publishReplicaCheckpoint(db, { previous: null, next: next.native });
      db.prepare(`INSERT INTO hindsight_application_replica_checkpoints
        (bank_id,provider_lineage,bank_generation,application_id,authority_epoch_id,native_cursor,state_cursor,checkpoint_json,checkpoint_hash,bank_deleted)
        VALUES (:bank,:lineage,:generation,:application,:authority,:native,:state,:json,:hash,0)`)
        .run({ bank: bankId, lineage: next.namespace.provider_lineage, generation, application: next.namespace.application_id,
          authority: next.authorityEpochId, native: next.checkpoint.native_cursor, state: next.checkpoint.state_cursor,
          json: JSON.stringify(next), hash: applicationCheckpointHash(next) });
    }
  });
}

it("isolates actual backup.capture 256/257 and template-aware Healthy identity 1024/1025 capacities", async () => {
  const h = await templateBackupConsumerFixture("unselected");
  try {
    const db = h.joint.fixture.db; const repo = createHindsightBankSetupRepo(db);
    h.joint.fixture.live.banks = () => repo.list().map((row) => ({ bankId: row.externalBankId, scope: row.scope,
      characterId: row.scope === "character" ? row.canonicalIdentity.slice(10) : null }));
    const lineage = h.source.native.manifest.provider.lineage;
    if (!lineage) throw new Error("capacity fixture requires verified Native lineage");
    const identity = () => readHealthyTransitionIdentity(db, { kind: "transition.return-local", templateBackup: true,
      fingerprint: h.joint.fixture.live.configFingerprint, providerLineage: lineage });
    addBanks(db, 256);
    const captured = await h.joint.capture(); expect(captured.staged.request.nativeBankIds).toHaveLength(256);
    addBanks(db, 257); const copy = vi.spyOn(db, "backupTo");
    await expect(h.joint.capture()).rejects.toThrow(); expect(copy).not.toHaveBeenCalled();
    expect(identity().banks).toHaveLength(257); expect(identity().templates).toBeDefined();
    addBanks(db, 1024); expect(identity().banks).toHaveLength(1024); expect(identity().templates).toBeDefined();
    addBanks(db, 1025); expect(identity).toThrow();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { vi.restoreAllMocks(); await h.close(); }
}, 60_000);
