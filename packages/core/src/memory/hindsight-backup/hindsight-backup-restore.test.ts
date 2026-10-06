import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { HindsightBackupManifestSchema } from "@taki/shared";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { composeEmergencyFixture } from "../../testing/memory-transition-emergency-service-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { createHindsightBackupStore } from "./hindsight-backup-store.ts";
import { validateHindsightRestoreCore } from "./hindsight-backup-restore.ts";
import { openReadonlyDatabase } from "../../db/sqlite.ts";
import { createSecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import { resolveMasterKeySource } from "../../secrets/master-key.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { readHindsightBackupCustody } from "./hindsight-backup-custody.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => vi.useRealTimers());

describe("current D91 paired Core restore preflight", () => {
  it("captures an actual W4 receipt and validates full replica bodies before writers, refusing unsafe pairs", async () => {
    const h = await createHealthyTransitionHarness({ aliases: true });
    let e: ReturnType<typeof composeEmergencyFixture> | undefined;
    try {
      for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
        const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
        expect(h.owner.status(operation.operationId).state).toBe("completed");
      }
      // The synthetic journey's service uses a fixed fingerprint; align its mutable reviewed row with the
      // real composed runtime before testing a new capture, just as production revalidation records it.
      h.db.prepare("UPDATE hindsight_connection_state SET config_fingerprint=:value WHERE singleton=1")
        .run({ value: h.runtime.operations()!.configFingerprint });
      e = composeEmergencyFixture(h);
      const operation = e.emergencyOwner.submit({ kind: "backup.capture", expectedEpochId: h.runtime.operations()!.epochId, route: "operator-artifact" });
      await e.emergencyOwner.stop(); expect(e.emergencyOwner.status(operation.operationId).state).toBe("completed");
      const settled = e.emergencyOwner.status(operation.operationId);
      const backupId = settled.producer!.kind === "backup" ? settled.producer!.backupId : "";
      const store = createHindsightBackupStore(h.dataDir); const staged = (await store.readStaged(backupId))!;
      expect(staged.core.authority.activationTransactionId).toBeNull(); expect(staged.core.authority.transitionReceiptId).toMatch(/^[a-f0-9]{64}$/);
      const manifest = HindsightBackupManifestSchema.parse({ ...staged.core, route: "operator-artifact", sensitive: true, verifiedAt: W3_AT,
        native: { location: "core-dir", file: "native.zip", nativeManifestVersion: "2", schema: "owned",
          proof: { providerLineage: staged.core.authority.providerLineageId, alembicRevision: "owned", compatibilityBuild: "owned", upstreamCommit: "owned",
            banks: staged.core.banks.map((bank) => ({ bankId: bank.nativeBankId, bankGeneration: bank.bankGeneration,
              currentCursor: bank.core.replicaCursor, minimumAvailableCursor: 0,
              application: { nativeCursor: bank.core.applicationNativeCursor, stateCursor: bank.core.applicationStateCursor } })),
            receipts: { ...staged.core.terminalOperations, missingCount: 0, missingSample: [] }, zipSha256: "a".repeat(64), zipBytes: 1 } } });
      const copy = openReadonlyDatabase(join(store.root, `${backupId}.staged`, "core.sqlite"));
      try {
        const input = { manifest, native: manifest.native.proof, nativeSchema: "owned", coreSha256: manifest.core.sha256,
          coreBytes: manifest.core.bytes, missingCredentials: () => [] };
        const result = validateHindsightRestoreCore(copy, input);
        expect(result.banks).toHaveLength(2); expect(result.banks.every((bank) => bank.bodies > 0)).toBe(true);
        expect(() => validateHindsightRestoreCore(copy, { ...input, missingCredentials: () => ["owned:missing"] })).toThrow("CREDENTIAL_MISSING");
        expect(() => validateHindsightRestoreCore(copy, { ...input, coreSha256: "b".repeat(64) })).toThrow("ARTIFACT_INVALID");
        expect(() => validateHindsightRestoreCore(copy, { ...input, nativeSchema: "other" })).toThrow("NATIVE_INCOMPATIBLE");
        expect(() => validateHindsightRestoreCore(copy, { ...input, manifest: { ...manifest,
          authority: { ...manifest.authority, transitionReceiptId: "c".repeat(64) } } })).toThrow("PAIR_MISMATCH");
        const olderNative = structuredClone(manifest.native.proof); olderNative.banks[0]!.currentCursor = 0;
        expect(() => validateHindsightRestoreCore(copy, { ...input, native: olderNative })).toThrow("PAIR_MISMATCH");
        const missingReceipt = structuredClone(manifest.native.proof); missingReceipt.receipts.digest = "d".repeat(64);
        expect(() => validateHindsightRestoreCore(copy, { ...input, native: missingReceipt })).toThrow("PAIR_MISMATCH");
        const missingBank = structuredClone(manifest); missingBank.banks.pop();
        expect(() => validateHindsightRestoreCore(copy, { ...input, manifest: missingBank })).toThrow("READBACK_MISMATCH");
        expect(() => HindsightBackupManifestSchema.parse({ ...manifest, authority: { ...manifest.authority, activationTransactionId: "invented" } })).toThrow();
      } finally { copy.close(); }
      await credentialHarness(join(store.root, `${backupId}.staged`, "core.sqlite"), manifest);
    } finally { await e?.stopEmergency(); await h.close(); }
  }, 30_000);
});

/** Native proof is synthetic here; the separately executed owned-PG drill proves Native restore. */
async function credentialHarness(corePath: string, sourceManifest: ReturnType<typeof HindsightBackupManifestSchema.parse>) {
  const repo = fileURLToPath(new URL("../../../../../", import.meta.url));
  const root = resolve(repo, ".trellis/.runtime/stage4-w6-restore", `credential-${randomUUID()}`);
  const pairDir = join(root, "pair"); const custodyDataDir = join(root, "custody"); const keys = join(root, "keys");
  for (const path of [root, pairDir, custodyDataDir, keys]) mkdirSync(path, { recursive: true });
  writeFileSync(join(keys, "taki-secret-catalog-master-key"), randomBytes(32), { flag: "wx" });
  const hostId = randomUUID(); writeFileSync(join(custodyDataDir, "host-identity.json"), JSON.stringify({ hostId }));
  const catalog = await createSecretCatalogService({ filePath: join(custodyDataDir, "secret-catalog.bin"), storeId: hostId,
    keySource: resolveMasterKeySource({ TAKI_CREDENTIALS_DIRECTORY: keys }), logger: createCaptureLogger().logger });
  catalog.set("memory.hindsight.apiKey", "owned-synthetic-credential");
  const manifest = structuredClone(sourceManifest); manifest.custody = readHindsightBackupCustody({ catalog, storeId: hostId });
  const nativeArchivePath = join(root, "native.zip"); const archive = Buffer.from("owned synthetic archive, not Native restore proof");
  writeFileSync(nativeArchivePath, archive); manifest.native.proof.zipSha256 = createHash("sha256").update(archive).digest("hex");
  manifest.native.proof.zipBytes = archive.byteLength;
  copyFileSync(corePath, join(pairDir, "core.sqlite")); writeFileSync(join(pairDir, "manifest.json"), JSON.stringify(manifest));
  const nativeResultPath = join(root, "native-result.json");
  writeFileSync(nativeResultPath, JSON.stringify({ completed: true, sourceUnchanged: true, backupId: manifest.backupId,
    sourceSchema: manifest.native.schema, targetSchema: `w6_restore_${"a".repeat(32)}`, native: manifest.native.proof }));
  const planPath = join(root, "plan.json"); writeFileSync(planPath, JSON.stringify({ ownedRoot: root, coreStopped: true,
    pairDir, nativeResultPath, custodyDataDir, nativeArchivePath }));
  const driver = join(repo, ".trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-paired-core-restore.mjs");
  const run = spawnSync(process.execPath, [driver, "--run-owned-preflight", "--plan", planPath], { cwd: repo, encoding: "utf8",
    env: { ...process.env, TAKI_CREDENTIALS_DIRECTORY: keys }, timeout: 20_000, windowsHide: true });
  expect(run.status, run.stderr + run.stdout).toBe(0);
  expect(JSON.parse(readFileSync(join(root, "core-restore-preflight.json"), "utf8"))).toMatchObject({ completed: true,
    credentialHealth: "ok", inputsUnchanged: true, coreStarted: false, modelStarted: false });
  // Direct exported read-only gate exercises missing key without erasing the first execution's immutable report.
  const probe = `const m=await import(${JSON.stringify(pathToFileURL(driver).href)});const fs=await import('node:fs');try{await m.auditPairedRestore(JSON.parse(fs.readFileSync(process.argv[1],'utf8')));process.exitCode=1}catch(e){if(e.message!=='W6_RESTORE_CREDENTIAL_CATALOG_UNAVAILABLE')throw e}`;
  const missing = spawnSync(process.execPath, ["--input-type=module", "-e", probe, planPath], { cwd: repo, encoding: "utf8",
    env: { ...process.env, TAKI_CREDENTIALS_DIRECTORY: join(root, "absent-keys") }, timeout: 20_000, windowsHide: true });
  expect(missing.status, missing.stderr).toBe(0);
}
