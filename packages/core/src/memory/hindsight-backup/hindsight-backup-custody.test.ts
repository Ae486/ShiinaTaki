import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../db/sqlite.ts";
import { generateCatalogKey } from "../../secrets/secret-catalog-envelope.ts";
import { createSecretCatalogService, type SecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { HINDSIGHT_SECRET_REFS } from "../hindsight/hindsight-secret-refs.ts";
import { sealEmergencyEvidence } from "./hindsight-backup-emergency.ts";
import { missingHindsightCredentials, readHindsightBackupCustody } from "./hindsight-backup-custody.ts";
import { BACKUP_ID } from "./hindsight-backup-fixtures.ts";
import { backupHarness, harnessStaged, operatorZip, putInbox } from "./hindsight-backup-harness.ts";

const STORE = "77777777-7777-4777-8777-777777777777";
const SENTINEL = "sentinel-hindsight-api-key-0123456789";
const EXTRA_REF = "memory.hindsight.webhook.token";
const KEY = generateCatalogKey();

const dirs: string[] = []; const dbs: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });

async function catalog(): Promise<{ service: SecretCatalogService; file: string }> {
  const dir = mkdtempSync(join(tmpdir(), "taki-custody-")); dirs.push(dir);
  const file = join(dir, "secret-catalog.bin");
  const service = await createSecretCatalogService({ filePath: file, storeId: STORE, logger: createCaptureLogger().logger,
    keySource: { kind: "credentials-directory", canCreate: false, read: () => KEY, create: () => undefined } });
  return { service, file };
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

describe("credential custody (§5.9)", () => {
  it("records presence and provenance of every Hindsight ref from the catalog, never a value, envelope or backup()", async () => {
    const { service, file } = await catalog();
    service.set(HINDSIGHT_SECRET_REFS.connectionApiKey, SENTINEL);
    service.set(EXTRA_REF, SENTINEL);
    service.set("mcp.server.other.token", SENTINEL);
    const guarded: SecretCatalogService = { ...service, resolve: vi.fn(service.resolve), backup: vi.fn(service.backup) };
    const custody = readHindsightBackupCustody({ catalog: guarded, storeId: STORE });
    expect(custody.refs.map((ref) => ref.ref)).toEqual([...Object.values(HINDSIGHT_SECRET_REFS), EXTRA_REF]);
    expect(custody.refs.filter((ref) => ref.present).map((ref) => ref.ref)).toEqual([HINDSIGHT_SECRET_REFS.connectionApiKey, EXTRA_REF]);
    expect(guarded.backup).not.toHaveBeenCalled();
    expect(guarded.resolve).not.toHaveBeenCalled();

    const h = backupHarness({ dirs, dbs }, { custody: () => readHindsightBackupCustody({ catalog: guarded, storeId: STORE }) });
    await h.capture("operator-artifact");
    putInbox(h.store.root, { name: "native.zip", bytes: await operatorZip(harnessStaged(h)) });
    expect(await h.service.admit({ backupId: BACKUP_ID, fileName: "native.zip", expectedEpochId: "epoch", checkpoint: () => undefined })).toMatchObject({ ok: true });
    await sealEmergencyEvidence({ db: h.db, store: h.store, lastVerified: h.service.lastVerified() });
    const envelope = readFileSync(file);
    const artifacts = files(h.store.root);
    expect(artifacts.length).toBeGreaterThan(5);
    for (const artifact of artifacts) {
      const bytes = readFileSync(artifact);
      expect(bytes.includes(SENTINEL)).toBe(false);
      expect(bytes.includes(envelope.subarray(-32))).toBe(false);
    }
    expect(guarded.backup).not.toHaveBeenCalled();
    expect(guarded.resolve).not.toHaveBeenCalled();
  });

  it("names every ref the record saw present that a target catalog lacks", async () => {
    const source = await catalog(); const target = await catalog();
    source.service.set(HINDSIGHT_SECRET_REFS.connectionApiKey, SENTINEL);
    source.service.set(EXTRA_REF, SENTINEL);
    const custody = readHindsightBackupCustody({ catalog: source.service, storeId: STORE });
    expect(missingHindsightCredentials(custody, target.service)).toEqual([HINDSIGHT_SECRET_REFS.connectionApiKey, EXTRA_REF]);
    target.service.set(EXTRA_REF, "restored");
    expect(missingHindsightCredentials(custody, target.service)).toEqual([HINDSIGHT_SECRET_REFS.connectionApiKey]);
    expect(missingHindsightCredentials(custody, source.service)).toEqual([]);
  });
});
