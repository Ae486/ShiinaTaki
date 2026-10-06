/** Owned D91 route-b producer. Real operation owner/runtime construction; never starts background/model/Native work. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length === 0) { console.log(JSON.stringify({ executed: false, completed: false })); process.exit(0); }
assert.equal(args.length, 5); assert.equal(args[0], "--run-owned-pair"); assert.equal(args[1], "--plan"); assert.equal(args[3], "--phase");
const phase = args[4]; assert(["stage", "seal"].includes(phase));
const plan = JSON.parse(readFileSync(args[2], "utf8"));
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."); const root = realpathSync(plan.ownedRoot);
const inside = (base, path) => { const part = relative(base, path); return part !== "" && !part.startsWith("..") && !isAbsolute(part); };
assert(inside(join(repo, ".trellis/.runtime/stage4-w6-restore"), root)); assert.equal(plan.coreStopped, true);
const owned = (path) => { const value = realpathSync(path); assert(inside(root, value)); return value; };
const dataDir = owned(plan.coreDataDir); const dbPath = owned(plan.coreDbPath); assert.equal(dbPath, join(dataDir, "taki.db"));
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const checkpointPath = join(root, "paired-capture.json"); const checkpoint = phase === "seal" ? JSON.parse(readFileSync(checkpointPath, "utf8")) : null;
if (!checkpoint) assert(!existsSync(checkpointPath));
assert.equal(digest(dbPath), checkpoint?.workingCoreSha256 ?? plan.expectedCoreSha256, "W6_RESTORE_CORE_SOURCE_CHANGED");
const resultPath = join(root, `${phase}-result.json`); assert(!existsSync(resultPath), "W6_RESTORE_PRIOR_ATTEMPT_REQUIRES_REVIEW");
const counters = { nativeCalls: 0, transportCalls: 0, modelCalls: 0 };
const result = { executed: true, completed: false, phase, processId: process.pid, counters };
writeFileSync(resultPath, JSON.stringify(result), { flag: "wx" });
const { openDatabase } = await import("../../../../packages/core/src/db/sqlite.ts");
const { MIGRATIONS } = await import("../../../../packages/core/src/db/migrations/index-list.ts");
const { createConfigRepo } = await import("../../../../packages/core/src/db/config-repo.ts");
const { createConfigSource } = await import("../../../../packages/core/src/config/config-source.ts");
const { createTimelineRepo } = await import("../../../../packages/core/src/db/timeline-repo.ts");
const { createSummaryRepo } = await import("../../../../packages/core/src/db/summary-repo.ts");
const { composeMemoryRuntime } = await import("../../../../packages/core/src/memory/runtime-composition.ts");
const { createMemoryOperationService } = await import("../../../../packages/core/src/memory/operations/memory-operation-service.ts");
const { fakeSetup } = await import("../../../../packages/core/src/memory/operations/memory-operation-fixtures.ts");
const { createHindsightBackupService } = await import("../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-service.ts");
const { createHindsightBackupStore } = await import("../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-store.ts");
const { createUnavailableHindsightBackupRoute } = await import("../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-route.ts");
const { readHindsightBackupCustody, missingHindsightCredentials } = await import("../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-custody.ts");
const { createSecretCatalogService } = await import("../../../../packages/core/src/secrets/secret-catalog-service.ts");
const { resolveMasterKeySource } = await import("../../../../packages/core/src/secrets/master-key.ts");
const { sealCatalog } = await import("../../../../packages/core/src/secrets/secret-catalog-envelope.ts");
const { HINDSIGHT_SECRET_REFS } = await import("../../../../packages/core/src/memory/hindsight/hindsight-secret-refs.ts");
const { readHindsightLiveConnection } = await import("../../../../packages/core/src/memory/hindsight/hindsight-runtime-connection.ts");
const { createHindsightClient } = await import("../../../../packages/core/src/memory/hindsight/hindsight-client.ts");
const { createCaptureLogger } = await import("../../../../packages/core/src/testing/capture-logger.ts");
const { failingGenerateModel } = await import("../../../../packages/core/src/testing/mock-language-model.ts");
const { logger, records } = createCaptureLogger(); const model = failingGenerateModel(new Error("W6_MODEL_FORBIDDEN"));
for (const key of ["doGenerate", "doStream"]) model[key] = async () => { counters.modelCalls++; throw new Error("W6_MODEL_FORBIDDEN"); };
const client = new Proxy(createHindsightClient({ endpoint: "http://127.0.0.1:1", resolveApiKey: () => null,
  transport: async () => { counters.transportCalls++; throw new Error("W6_NATIVE_TRANSPORT_FORBIDDEN"); } }), {
  get(target, key) { const value = target[key]; return typeof value === "function"
    ? async () => { counters.nativeCalls++; throw new Error("W6_NATIVE_FORBIDDEN"); } : value; },
});
let db; let runtime; let backup; let owner;
try {
  result.step = "custody";
  if (phase === "stage" && plan.initializeOwnedFixtureCustody === true) {
    assert(!existsSync(join(dataDir, "host-identity.json")) && !existsSync(join(dataDir, "secret-catalog.bin")), "W6_RESTORE_CUSTODY_ALREADY_EXISTS");
    // This is the original public test HTTP credential, not any Native model/PG credential or user catalog.
    const keyDir = owned(process.env.TAKI_CREDENTIALS_DIRECTORY); owned(join(keyDir, "taki-secret-catalog-master-key"));
    const fixtureHostId = randomUUID(); writeFileSync(join(dataDir, "host-identity.json"), JSON.stringify({ hostId: fixtureHostId }), { flag: "wx" });
    const fixtureKey = resolveMasterKeySource({ TAKI_CREDENTIALS_DIRECTORY: keyDir });
    const fixture = await createSecretCatalogService({ filePath: join(dataDir, "secret-catalog.bin"), storeId: fixtureHostId, logger, keySource: fixtureKey });
    // Preserve the original test adapter's public provenance through the existing authenticated restore API.
    // set() intentionally allocates a current timestamp and would represent a different connection identity.
    const rawKey = fixtureKey.read(); assert(rawKey, "W6_RESTORE_FIXTURE_KEY_UNAVAILABLE");
    try { fixture.restore(sealCatalog({ version: 1, createdAt: "2026-10-03T00:00:00.000Z", keyVersion: 1, storeId: fixtureHostId,
      entries: { [HINDSIGHT_SECRET_REFS.connectionApiKey]: { value: "w5-owned-healthy-fixture", updatedAt: "2026-10-03T00:00:00.000Z" } } }, rawKey)); }
    finally { rawKey.fill(0); }
    result.custody = "owned-fixture-http-only";
  }
  const host = JSON.parse(readFileSync(owned(join(dataDir, "host-identity.json")), "utf8"));
  const key = resolveMasterKeySource(process.env);
  const catalog = await createSecretCatalogService({ filePath: owned(join(dataDir, "secret-catalog.bin")), storeId: host.hostId, logger,
    keySource: key ? { ...key, canCreate: false, create: () => { throw new Error("W6_RESTORE_KEY_CREATION_FORBIDDEN"); } } : null });
  if (catalog.health() !== "ok") throw new Error("W6_RESTORE_CREDENTIAL_CATALOG_UNAVAILABLE");
  db = openDatabase({ path: dbPath, migrations: MIGRATIONS });
  result.step = "source-identity";
  const env = plan.connectionEnv ?? {};
  const allowed = new Set(["TAKI_HINDSIGHT_ENABLED", "TAKI_HINDSIGHT_ENDPOINT", "TAKI_HINDSIGHT_DEPLOYMENT_MODE", "TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", "TAKI_HINDSIGHT_SETUP_TIMEOUT_MS", "TAKI_HINDSIGHT_TEMPLATE_REVISION"]);
  assert(Object.keys(env).every((key) => allowed.has(key)), "W6_RESTORE_INVALID_CONNECTION_ENV");
  const config = createConfigSource({ repo: createConfigRepo(db), env });
  const configured = readHindsightLiveConnection({ config, secrets: catalog });
  assert.equal(configured.state, "ready", "W6_RESTORE_CONNECTION_NOT_READY");
  assert.equal(configured.fingerprint, db.prepare("SELECT config_fingerprint FROM hindsight_connection_state WHERE singleton=1").get()?.config_fingerprint,
    "W6_RESTORE_CONNECTION_IDENTITY_MISMATCH");
  result.step = "runtime-construction";
  runtime = composeMemoryRuntime({ db, dataDir, promptDir: join(dataDir, "prompt"), bootId: randomUUID(), model,
    timeline: createTimelineRepo(db), summaries: createSummaryRepo(db), windowStart: () => 1, estimatedTokens: () => 0,
    budget: () => 100_000, compact: { triggerRatio: 0.8, keepMessages: 3 }, env: {}, logger,
    hindsight: { source: config, secrets: catalog, client } });
  // Construction validates the selected receipt and publishes an idle runtime. start() is intentionally never called.
  const live = runtime.operations(); assert(live, "W6_RESTORE_HINDSIGHT_RUNTIME_UNAVAILABLE");
  const store = createHindsightBackupStore(dataDir);
  backup = createHindsightBackupService({ db, store, logger, route: createUnavailableHindsightBackupRoute(),
    custody: () => readHindsightBackupCustody({ catalog, storeId: host.hostId }), missingCredentials: (custody) => missingHindsightCredentials(custody, catalog) });
  owner = createMemoryOperationService({ db, live: runtime.operations, setup: fakeSetup(), backup, bootId: randomUUID(), logger, onChanged: () => undefined });
  let request;
  if (phase === "stage") request = { kind: "backup.capture", expectedEpochId: live.epochId, route: "operator-artifact" };
  else {
    const native = JSON.parse(readFileSync(owned(plan.nativeResultPath), "utf8"));
    assert.equal(native.completed, true); assert.equal(native.backupId, checkpoint.backupId);
    const archive = owned(plan.nativeArchivePath); assert.equal(digest(archive), native.native.zipSha256);
    const inbox = join(store.root, "inbox"); mkdirSync(inbox, { recursive: true });
    copyFileSync(archive, join(inbox, "w6-paired-native.zip"), constants.COPYFILE_EXCL);
    request = { kind: "backup.admit", expectedEpochId: live.epochId, backupId: checkpoint.backupId, fileName: "w6-paired-native.zip" };
  }
  result.step = "operation";
  const admitted = owner.submit(request); await owner.stop(); const settled = owner.status(admitted.operationId);
  if (settled.state !== "completed" || settled.producer?.kind !== "backup") throw new Error(settled.errorCode ?? "W6_RESTORE_CAPTURE_INCOMPLETE");
  result.backupId = settled.producer.backupId; result.operationId = settled.operationId;
  const artifact = join(store.root, phase === "stage" ? `${result.backupId}.staged` : result.backupId);
  result.pairDir = artifact; result.nativeRequestPath = join(artifact, "native-request.json");
  result.coreSha256 = digest(join(artifact, "core.sqlite"));
  assert.deepEqual(counters, { nativeCalls: 0, transportCalls: 0, modelCalls: 0 });
  await backup.stop(); await runtime.stop(); db.close(); db = null;
  result.workingCoreSha256 = digest(dbPath); result.stopped = true; result.completed = true;
  if (phase === "stage") writeFileSync(checkpointPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
} catch (error) {
  const code = (error.message ?? "").split("\n")[0];
  result.error = /^(W6_|HINDSIGHT_|MEMORY_)[A-Z_]+$/.test(code) ? code : "W6_RESTORE_CAPTURE_FAILED";
  result.diagnostics = records.map((row) => row.obj?.code).filter((code) => typeof code === "string" && /^(MEMORY_|HINDSIGHT_)[A-Z_]+$/.test(code)).slice(-10);
  process.exitCode = 1;
} finally {
  await owner?.stop(); await backup?.stop(); await runtime?.stop(); db?.close();
  writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
}
