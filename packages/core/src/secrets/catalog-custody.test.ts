import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HINDSIGHT_SECRET_REFS, type HindsightFixedSelection } from "@taki/shared/hindsight-custody";
import { generateCatalogKey } from "./secret-catalog-envelope.ts";
import { createSecretCatalogService } from "./secret-catalog-service.ts";
import * as publication from "./catalog-publication.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";

const STORE = "11111111-1111-4111-8111-111111111111";
const SELECTION: HindsightFixedSelection = [{ slot: "defaultModelApiKey", source: "catalog" }, { slot: "retainModelApiKey", source: "inherit-default" }];
const directories: string[] = [];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "taki-c1-catalog-")); directories.push(directory);
  const filePath = join(directory, "secret-catalog.bin");
  const key = generateCatalogKey();
  const keySource = { kind: "credentials-directory" as const, canCreate: false, read: () => key, create: () => { throw new Error("read-only fake key source"); } };
  const deps = { filePath, storeId: STORE, keySource, logger: createCaptureLogger().logger };
  const catalog = await createSecretCatalogService(deps);
  catalog.set(HINDSIGHT_SECRET_REFS.defaultModelApiKey, "C1_FAKE_SENTINEL");
  return { directory, filePath, catalog, deps };
}

describe("Core-owned custody snapshot", () => {
  it("binds fixed-Date publications and ciphertext restore ABA without exposing revision or values", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-13T00:00:00.000Z"));
    const { catalog } = await fixture();
    const snapshot = catalog.captureCustodySnapshot(SELECTION);
    const original = catalog.backup();
    catalog.set(HINDSIGHT_SECRET_REFS.defaultModelApiKey, "changed in the same millisecond");
    expect(catalog.validateCustodySnapshot(snapshot)).toBe(false);
    catalog.restore(original.envelope);
    const restored = catalog.captureCustodySnapshot(SELECTION);
    expect(restored.sealedEnvelopeSha256).toBe(snapshot.sealedEnvelopeSha256);
    expect(restored.selection).toEqual(snapshot.selection);
    expect(catalog.validateCustodySnapshot(snapshot)).toBe(false);
    expect(catalog.validateCustodySnapshot(restored)).toBe(true);
    expect(JSON.stringify(restored)).not.toMatch(/C1_FAKE_SENTINEL|revision/);
  });

  it("refuses copied snapshots and those from another Core boot", async () => {
    const { catalog, deps } = await fixture();
    const snapshot = catalog.captureCustodySnapshot(SELECTION);
    expect(catalog.validateCustodySnapshot(structuredClone(snapshot))).toBe(false);
    const reopened = await createSecretCatalogService(deps);
    expect(reopened.validateCustodySnapshot(snapshot)).toBe(false);
    expect(reopened.captureCustodySnapshot(SELECTION).coreBootId).not.toBe(snapshot.coreBootId);
  });

  it("detects byte-identical external replacement and never reloads it", async () => {
    const { catalog, filePath, directory } = await fixture();
    const snapshot = catalog.captureCustodySnapshot(SELECTION);
    const copy = join(directory, "replacement.bin"); writeFileSync(copy, readFileSync(filePath)); renameSync(copy, filePath);
    expect(catalog.validateCustodySnapshot(snapshot)).toBe(false);
    expect(() => catalog.captureCustodySnapshot(SELECTION)).toThrow("catalog custody unavailable");
    expect(catalog.resolve(HINDSIGHT_SECRET_REFS.defaultModelApiKey)).toBe("C1_FAKE_SENTINEL");
  });

  it("does not invalidate a successful publication on a failed write or absent clear", async () => {
    const { catalog, filePath } = await fixture();
    const snapshot = catalog.captureCustodySnapshot(SELECTION); const bytes = readFileSync(filePath); const revision = catalog.revision();
    vi.spyOn(publication, "publishFileAtomically").mockImplementationOnce(() => { throw new Error("injected publication failure"); });
    expect(() => catalog.set(HINDSIGHT_SECRET_REFS.defaultModelApiKey, "refused")).toThrow("store-write-failed");
    catalog.clear(HINDSIGHT_SECRET_REFS.rerankerApiKey);
    expect(catalog.revision()).toBe(revision);
    expect(readFileSync(filePath)).toEqual(bytes);
    expect(catalog.validateCustodySnapshot(snapshot)).toBe(true);
  });

  it("invalidates on rotation and nonempty clear and refuses missing or oversized selected values", async () => {
    const { catalog } = await fixture();
    let snapshot = catalog.captureCustodySnapshot(SELECTION);
    catalog.rotateToKey(generateCatalogKey()); expect(catalog.validateCustodySnapshot(snapshot)).toBe(false);
    snapshot = catalog.captureCustodySnapshot(SELECTION);
    catalog.clear(HINDSIGHT_SECRET_REFS.defaultModelApiKey); expect(catalog.validateCustodySnapshot(snapshot)).toBe(false);
    expect(() => catalog.captureCustodySnapshot(SELECTION)).toThrow("catalog custody unavailable");
    catalog.set(HINDSIGHT_SECRET_REFS.defaultModelApiKey, "a".repeat(65_537));
    expect(() => catalog.captureCustodySnapshot(SELECTION)).toThrow("catalog custody unavailable");
  });

  it("refuses locked and tampered stores without creating or replacing key material", async () => {
    const { catalog, deps, filePath } = await fixture();
    const locked = await createSecretCatalogService({ ...deps, keySource: null });
    expect(() => locked.captureCustodySnapshot(SELECTION)).toThrow("catalog custody unavailable");
    const snapshot = catalog.captureCustodySnapshot(SELECTION); const bytes = readFileSync(filePath);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; writeFileSync(filePath, bytes);
    expect(catalog.validateCustodySnapshot(snapshot)).toBe(false);
  });
});
