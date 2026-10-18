/** Owned Native integration runner: real HTTP receipts and Core producers; fixture authority/runtime are disclosed. */
import assert from "node:assert/strict";
import { copyFile, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHindsightClient } from "../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { createJointTemplateBackupFixture, jointTemplateBackupSeed, JOINT_TEMPLATE_USER_MODEL } from "../../../../packages/core/src/testing/hindsight-template-backup-joint-fixture.ts";
import { hindsightFixtureSecrets } from "../../../../packages/core/src/testing/hindsight-runtime-composition-fixtures.ts";
import { createCaptureLogger } from "../../../../packages/core/src/testing/capture-logger.ts";
import { createHindsightBackupStore } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-store.ts";
import { admitHindsightBackup } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-admit.ts";
import { verifyHindsightBackup } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-verify.ts";
import { createUnavailableHindsightBackupRoute } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-route.ts";
import { readHindsightBackupCopy } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-copy-readback.ts";
import { runHindsightRestorePreflight } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-backup-preflight-operator.ts";
import { openReadonlyDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { readHindsightTemplateBackupHistory } from "../../../../packages/core/src/memory/hindsight-backup/hindsight-template-backup-history.ts";

const [mode, inputPath, outputDir] = process.argv.slice(2);
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
if (mode === "seed") { emit({ ...jointTemplateBackupSeed(), userModel: JOINT_TEMPLATE_USER_MODEL }); }
else {
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(input.endpoint ?? "http://127.0.0.1").hostname), "owned loopback service only");
  if (mode === "prepare") await prepare(input, outputDir);
  else if (mode === "admit") await admit(input, outputDir);
  else if (mode === "verify") await verify(input);
  else if (mode === "preflight") await preflight(input);
  else throw new Error("expected seed, prepare, admit, verify or preflight");
}

async function prepare(input, directory) {
  const apiKey = process.env.TAKI_B3_JOINT_API_KEY;
  assert.ok(apiKey, "isolated API key must be injected by the owned Native runner");
  const client = createHindsightClient({ endpoint: input.endpoint, resolveApiKey: () => apiKey });
  const fixture = await createJointTemplateBackupFixture({ endpoint: input.endpoint, client, targets: input.targets });
  try {
    const status = await fixture.prepare(input.scenario, { refresh: true });
    const capture = await fixture.capture();
    const copied = readHindsightBackupCopy(capture.corePath, capture.staged.core, capture.staged.request);
    assert.equal(copied.version, 2);
    await mkdir(directory, { recursive: true });
    await copyFile(capture.corePath, join(directory, "core.sqlite"));
    await writeFile(join(directory, "native-request.json"), JSON.stringify(capture.staged.request), { encoding: "utf8", flag: "wx" });
    await writeFile(join(directory, "core-identity.json"), JSON.stringify(capture.staged.core), { encoding: "utf8", flag: "wx" });
    const user = copiedUserModel(capture.corePath, copied);
    assert.deepEqual(user, JOINT_TEMPLATE_USER_MODEL);
    emit({ state: "staged", backupId: capture.backupId, corePath: join(directory, "core.sqlite"),
      requestPath: join(directory, "native-request.json"), coreIdentityPath: join(directory, "core-identity.json"),
      selection: status.bank.selected.templateRevision, requestHash: copied.request.requestHash,
      userModel: user, refresh: copiedRefresh(capture.corePath, copied),
      receiptCounts: copied.state.attestation.banks.map((bank) => bank.receiptInventory.count),
      boundary: "actual Core lifecycle/operation/publication/copy and authenticated Native Apply; initial authority/replica and runtime delegates are fixtures" });
  } finally { await fixture.close(); }
}
async function admit(input, directory) {
  const request = JSON.parse(await readFile(input.requestPath, "utf8"));
  const core = JSON.parse(await readFile(input.coreIdentityPath, "utf8"));
  const store = createHindsightBackupStore(directory);
  await store.begin(request.backupId);
  await store.captureCore(request.backupId, async (path) => { await copyFile(input.corePath, path); return core.core.pages; });
  await store.stage({ request, core });
  await mkdir(join(store.root, "inbox"), { recursive: true });
  await copyFile(input.nativeZipPath, join(store.root, "inbox", "joint-native.zip"));
  const result = await admitHindsightBackup({ store, logger: createCaptureLogger().logger, now: () => new Date().toISOString() },
    { backupId: request.backupId, fileName: "joint-native.zip", expectedEpochId: core.authority.epochId, checkpoint: () => undefined });
  if (!result.ok) { emit({ state: "refused", writerStarts: 0, code: result.code, mismatch: result.mismatch }); process.exitCode = 2; return; }
  emit({ state: "admitted", backupId: request.backupId, corePath: store.corePath(request.backupId),
    manifestPath: join(store.root, request.backupId, "manifest.json"), nativePath: store.nativePath(request.backupId) });
}
async function verify(input) {
  const store = createHindsightBackupStore(input.ownedDataDir);
  const result = await verifyHindsightBackup({ store, route: createUnavailableHindsightBackupRoute(), logger: createCaptureLogger().logger,
    now: () => new Date().toISOString(), missingCredentials: () => [] }, { backupId: input.backupId, checkpoint: () => undefined });
  emit({ ...result, state: result.ok ? "verified" : "refused", verifiedAt: store.readSync(input.backupId)?.verifiedAt });
  if (!result.ok) process.exitCode = 2;
}
async function preflight(input) {
  const secrets = hindsightFixtureSecrets();
  secrets.state.value = process.env.TAKI_B3_JOINT_API_KEY ?? null;
  let writerStarts = 0;
  try {
    const result = await runHindsightRestorePreflight({ corePath: input.corePath, manifestPath: input.manifestPath,
      endpoint: input.endpoint, catalog: secrets.catalog });
    // An explicit test-only caller trap proves order; the production preflight starts no writer.
    writerStarts++;
    emit({ state: "ready", writerStarts, result });
  } catch (error) {
    emit({ state: "refused", writerStarts, code: error instanceof Error ? error.message : "unknown" });
    process.exitCode = 2;
  }
}
function copiedUserModel(path, copied) {
  const bank = copied.state.attestation.banks.find((entry) => entry.scope === "character");
  const db = openReadonlyDatabase(path);
  try {
    const history = readHindsightTemplateBackupHistory(db, { scope: bank.scope, canonicalIdentity: bank.canonicalIdentity, target: bank.target });
    const choice = history.users.at(-1).models.find((entry) => entry.id === JOINT_TEMPLATE_USER_MODEL.id).choice;
    assert.equal(choice.mode, "value"); return choice.value;
  } finally { db.close(); }
}

// Removal has its own original receipt; the refresh still belongs to the earlier
// customization. Read that immutable history rather than infer from current selection.
function copiedRefresh(path, copied) {
  const bank = copied.state.attestation.banks.find((entry) => entry.scope === "character");
  const db = openReadonlyDatabase(path);
  try {
    const history = readHindsightTemplateBackupHistory(db, { scope: bank.scope, canonicalIdentity: bank.canonicalIdentity, target: bank.target });
    const selected = history.selections.find((entry) => entry.receipt.children.some((child) => child.model_id === JOINT_TEMPLATE_USER_MODEL.id));
    assert.ok(selected, "actual original refresh request must survive the Core copy");
    const child = selected.receipt.children.find((entry) => entry.model_id === JOINT_TEMPLATE_USER_MODEL.id);
    assert.ok(copied.request.operationIds.includes("template-refresh-result:" + child.child_id), "Core must record the terminal semantic result");
    return { request: selected.request, receipt: selected.receipt, childId: child.child_id };
  } finally { db.close(); }
}
