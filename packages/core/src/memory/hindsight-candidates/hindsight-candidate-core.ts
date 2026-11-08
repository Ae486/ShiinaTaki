/**
 * INPUT:  a completed standalone Core backup and its sealed original v2 pair manifest
 * OUTPUT: immutable whole-file/schema/table inventory and existing selected-scope body/Pending/template read-back
 * POS:    D1 reader; imports no Core runtime, executes no copied jobs, migrations, repairs or authority writes
 */
import { HindsightBackupManifestSchema, type HindsightBackupManifestV2, type HindsightCandidateInventory } from "@taki/shared";
import { openReadonlyDatabase, type Database } from "../../db/sqlite.ts";
import { readCurrentReplicaClosure } from "../../db/memory-transition-surviving-capture.ts";
import { createPendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import { countPendingHindsightMemoryWrites } from "../../db/hindsight-memory-write-repo.ts";
import { readHindsightBackupCopyIdentity } from "../hindsight-backup/hindsight-backup-copied-identity.ts";
import { assertHindsightCopiedBackupIdentity } from "../hindsight-backup/hindsight-backup-copy-readback.ts";
import { verifyHindsightBackupPair } from "../hindsight-backup/hindsight-backup-pair.ts";
import { transitionLocalHash } from "../transitions/transition-local-encoding.ts";
import { assertCandidateDigest, assertCompletedCore, candidateDigest } from "./hindsight-candidate-files.ts";
import { HINDSIGHT_CANDIDATE_CORE_HEAD } from "./hindsight-candidate-profile.ts";
import { refuse, refusalOf } from "./hindsight-candidate-refusal.ts";

export async function readCandidateCore(path: string, raw: HindsightBackupManifestV2) {
  const parsed = HindsightBackupManifestSchema.safeParse(raw);
  if (!parsed.success) refuse("tampered", "manifest");
  const manifest = parsed.data;
  if (manifest.version !== 2 || manifest.core.migrationHead !== HINDSIGHT_CANDIDATE_CORE_HEAD) refuse("unsupported", "core");
  if (!manifest.verifiedAt) refuse("unsupported", "manifest");
  await assertCompletedCore(path);
  const before = await candidateDigest(path, "core");
  assertCandidateDigest(before, manifest.core, "core");
  let result;
  try {
    const db = openReadonlyDatabase(path);
    try { result = inspectCore(db, manifest); }
    finally { db.close(); }
  } catch (error) { throw refusalOf(error, ["tampered", "core"]); }
  await assertCompletedCore(path);
  assertCandidateDigest(await candidateDigest(path, "core"), before, "core");
  return { ...result, core: { ...before, migrationHead: manifest.core.migrationHead, epochId: manifest.authority.epochId,
    providerLineageId: manifest.authority.providerLineageId, ...result.schema } };
}

function inspectCore(db: Database, manifest: HindsightBackupManifestV2) {
  const copied = readHindsightBackupCopyIdentity(db, { version: 2, backupId: manifest.backupId, createdAt: manifest.createdAt,
    epochId: manifest.authority.epochId, configFingerprint: manifest.authority.configFingerprint, deploymentMode: manifest.authority.deploymentMode });
  assertHindsightCopiedBackupIdentity(copied, manifest);
  if (copied.version !== 2 || !verifyHindsightBackupPair(copied.identity.core, manifest.native.proof).ok) refuse("tampered", "manifest");
  const schema = readSchema(db);
  const pending = createPendingMemoryRepo(db);
  const banks: HindsightCandidateInventory["banks"] = copied.identity.core.banks.map((bank) => {
    if (bank.scope === "character" && bank.characterId === null) refuse("tampered", "core");
    const closure = readCurrentReplicaClosure(db, { epochId: manifest.authority.epochId, lineage: manifest.authority.providerLineageId,
      bank: { nativeBankId: bank.nativeBankId, nativeGeneration: bank.bankGeneration,
        scope: bank.scope === "global" ? { kind: "global", characterId: null } : { kind: "character", characterId: bank.characterId! } } });
    const ref = { authorityEpochId: manifest.authority.epochId, bankId: bank.nativeBankId };
    return { bankId: closure.bankId, checkpointHash: closure.checkpointHash, closureHash: transitionLocalHash(closure),
      heads: closure.heads.length, artifacts: closure.artifacts.length, bodies: closure.bodies.length,
      pending: pending.summary(ref), openParentWrites: countPendingHindsightMemoryWrites(db, ref) };
  });
  return { banks, request: copied.request, schema };
}

function readSchema(db: Database) {
  const objects = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  const tables = objects.filter((object) => object.type === "table").map((object) => {
    const name = String(object.name);
    const count = db.prepare(`SELECT count(*) AS rows FROM "${name.replaceAll('"', '""')}"`).get()?.rows;
    if (typeof count !== "number" || !Number.isSafeInteger(count)) refuse("unreadable", "table");
    return { name, rows: count };
  });
  const versions = db.prepare("SELECT version FROM migrations ORDER BY version").all();
  if (versions.length !== HINDSIGHT_CANDIDATE_CORE_HEAD || versions.some((row, index) => row.version !== index + 1)) {
    refuse("unsupported", "schema", { name: "migrations" });
  }
  return { schemaHash: transitionLocalHash(objects), tables };
}
