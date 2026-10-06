/** Read-only D91 pair/credential preflight. No runtime, key creation, replacement or model/network startup. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openReadonlyDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { validateHindsightRestoreCore } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-restore.ts";
import { missingHindsightCredentials } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-custody.ts";
import { createSecretCatalogService } from "../../../../packages/core/src/secrets/secret-catalog-service.ts";
import { resolveMasterKeySource } from "../../../../packages/core/src/secrets/master-key.ts";
import { createCaptureLogger } from "../../../../packages/core/src/testing/capture-logger.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (root, path) => { const part = relative(root, path); return part !== "" && !part.startsWith("..") && !isAbsolute(part); };

export async function auditPairedRestore(plan) {
  const root = realpathSync(plan.ownedRoot);
  assert(inside(join(repo, ".trellis/.runtime/stage4-w6-restore"), root), "W6_RESTORE_OWNED_ROOT_REQUIRED");
  assert.equal(plan.coreStopped, true, "W6_RESTORE_CORE_MUST_BE_STOPPED");
  const owned = (path) => { const value = realpathSync(path); assert(inside(root, value), "W6_RESTORE_PATH_NOT_OWNED"); return value; };
  const pairDir = owned(plan.pairDir); const corePath = owned(join(pairDir, "core.sqlite"));
  const manifestPath = owned(join(pairDir, "manifest.json")); const nativeResultPath = owned(plan.nativeResultPath);
  const custodyDir = owned(plan.custodyDataDir); const catalogPath = owned(join(custodyDir, "secret-catalog.bin"));
  // The recorded host identity remains the catalog's AAD. A copied envelope is not portable to a fresh host ID.
  const hostPath = owned(join(custodyDir, "host-identity.json"));
  const host = JSON.parse(readFileSync(hostPath, "utf8"));
  const paths = [corePath, manifestPath, nativeResultPath, catalogPath, hostPath];
  const originalHashes = paths.map((path) => sha(readFileSync(path)));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(host.hostId, manifest.custody.storeId, "W6_RESTORE_CUSTODY_STORE_MISMATCH");
  const restored = JSON.parse(readFileSync(nativeResultPath, "utf8"));
  assert.equal(restored.completed, true, "W6_RESTORE_NATIVE_INCOMPLETE");
  assert.equal(restored.sourceUnchanged, true, "W6_RESTORE_SOURCE_CHANGED");
  assert.equal(restored.backupId, manifest.backupId, "W6_RESTORE_BACKUP_ID_MISMATCH");
  assert.match(restored.targetSchema, /^w6_restore_[a-f0-9]{32}$/);
  assert.equal(restored.sourceSchema, manifest.native.schema, "W6_RESTORE_SCHEMA_MISMATCH");
  assert.deepEqual(restored.native, manifest.native.proof, "W6_RESTORE_NATIVE_PROOF_MISMATCH");
  const archivePath = owned(plan.nativeArchivePath); const archive = readFileSync(archivePath);
  assert.equal(sha(archive), restored.native.zipSha256, "W6_RESTORE_ARCHIVE_DIGEST_MISMATCH");
  assert.equal(archive.byteLength, restored.native.zipBytes, "W6_RESTORE_ARCHIVE_SIZE_MISMATCH");
  const source = resolveMasterKeySource(process.env);
  // Use the configured real custody mechanism, but remove first-boot create authority even if a helper supports it.
  const keySource = source ? { ...source, canCreate: false, create: () => { throw new Error("W6_RESTORE_KEY_CREATION_FORBIDDEN"); } } : null;
  const { logger } = createCaptureLogger();
  const catalog = await createSecretCatalogService({ filePath: catalogPath, storeId: host.hostId, keySource, logger });
  if (catalog.health() !== "ok") throw new Error("W6_RESTORE_CREDENTIAL_CATALOG_UNAVAILABLE");
  const core = readFileSync(corePath); const db = openReadonlyDatabase(corePath);
  let result;
  try {
    result = validateHindsightRestoreCore(db, { manifest, native: restored.native, nativeSchema: restored.sourceSchema,
      coreSha256: sha(core), coreBytes: core.byteLength, missingCredentials: (custody) => missingHindsightCredentials(custody, catalog) });
  } finally { db.close(); }
  assert.deepEqual(paths.map((path) => sha(readFileSync(path))), originalHashes, "W6_RESTORE_INPUT_CHANGED");
  return { completed: true, ...result, nativeTargetSchema: restored.targetSchema,
    coreSha256: sha(core), credentialHealth: catalog.health(), credentialRefs: manifest.custody.refs.filter((ref) => ref.present).map((ref) => ref.ref),
    inputsUnchanged: true, coreStarted: false, modelStarted: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 0) console.log(JSON.stringify({ executed: false, completed: false }));
  else {
    assert.deepEqual(args.slice(0, 2), ["--run-owned-preflight", "--plan"]); assert.equal(args.length, 3);
    const plan = JSON.parse(readFileSync(args[2], "utf8")); const root = realpathSync(plan.ownedRoot);
    assert(inside(join(repo, ".trellis/.runtime/stage4-w6-restore"), root));
    const resultPath = join(root, "core-restore-preflight.json"); assert(!existsSync(resultPath), "W6_RESTORE_PRIOR_PREFLIGHT_REQUIRES_REVIEW");
    let result;
    try { result = await auditPairedRestore(plan); }
    catch (error) { result = { completed: false, error: /^(W6_|HINDSIGHT_|MEMORY_)[A-Z_]+$/.test(error.message ?? "") ? error.message : "W6_RESTORE_PREFLIGHT_FAILED" }; process.exitCode = 1; }
    writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify(result));
  }
}
