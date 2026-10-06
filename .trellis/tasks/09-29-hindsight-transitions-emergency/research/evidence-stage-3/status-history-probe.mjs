// Read-only production-code probe. All database writes are confined to a fresh temporary fixture.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { openDatabase } from "../../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { createHindsightBankSetupRepo } from "../../../../../packages/core/src/db/hindsight-bank-setup-repo.ts";
import { publishReplicaCheckpoint } from "../../../../../packages/core/src/db/hindsight-replica-checkpoint-store.ts";
import { backupManifest, AT, GENERATION, LINEAGE } from "../../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-fixtures.ts";
import { readHindsightBackupStatus } from "../../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-status.ts";

const tempParent = realpathSync(tmpdir());
const owned = mkdtempSync(join(tempParent, "taki-stage3-history-probe-"));
const db = openDatabase({ path: join(owned, "probe.sqlite"), migrations: MIGRATIONS });
try {
  const bankId = "taki-hs-g";
  const currentGeneration = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  createHindsightBankSetupRepo(db).upsert({ scope: "global", canonicalIdentity: "global", externalBankId: bankId,
    templateRevision: "taki-bank-v1", templateDigest: "a".repeat(64), status: "verified",
    operationIds: [], lastVerifiedAt: AT, lastError: null });
  publishReplicaCheckpoint(db, { previous: null, next: { providerLineageId: LINEAGE, bankId,
    bankGeneration: currentGeneration, authorityEpochId: "epoch-h", replicaEpochId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    endCursor: 5, snapshotId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", snapshotCursor: 0,
    snapshotManifestDigest: "a".repeat(64), manifestDigest: "b".repeat(64), verifiedAt: AT } });
  const lastVerified = backupManifest({ sha256: "0".repeat(64), bytes: 1, pages: 1 });
  assert.notEqual(GENERATION, currentGeneration);
  const status = readHindsightBackupStatus(db, { epochId: "epoch-h", lastVerified, now: AT });
  assert.equal(status.missingInterval[0].fromNativeCursor, 10);
  assert.equal(status.missingInterval[0].toReplicaCursor, 5);
  console.log(JSON.stringify({ reproduced: true, expected: "incomparable histories must not form one numeric missing interval",
    backup: { lineage: LINEAGE, bankGeneration: GENERATION, cursor: 10 },
    current: { lineage: LINEAGE, bankGeneration: currentGeneration, cursor: 5 }, actual: status.missingInterval[0] }, null, 2));
} finally {
  db.close();
  const resolved = realpathSync(owned);
  assert.equal(dirname(resolved).toLowerCase(), tempParent.toLowerCase());
  assert.ok(basename(resolved).startsWith("taki-stage3-history-probe-"));
  rmSync(resolved, { recursive: true });
}
