import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sealCatalog, generateCatalogKey, sodiumReady } from "@taki/secret-catalog-codec";
import { HINDSIGHT_SECRET_REFS } from "@taki/shared/hindsight-custody";
import { canonicalCapabilityInput } from "@taki/shared/host-input";
import { HindsightHostRegistrationSchema } from "@taki/shared/hindsight-installation";
import { readCatalogKey } from "./credential-source.ts";
import { prepareCustody } from "./prepare-custody.ts";
import { invocationFixture } from "./custody-test-fixtures.ts";
import { sha256 } from "./installed-files.ts";
import type { VerifiedInstallation } from "./installation.ts";
import { CustodyError } from "./custody-error.ts";

vi.mock("./credential-source.ts", () => ({ readCatalogKey: vi.fn() }));
const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.mocked(readCatalogKey).mockReset(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

async function fixture(value = "C1_FAKE_SENTINEL") {
  await sodiumReady;
  const directory = mkdtempSync(join(tmpdir(), "taki-c1-read-")); directories.push(directory);
  const invocation = invocationFixture(); const key = generateCatalogKey();
  const updatedAt = "2026-10-13T00:00:00.000Z";
  const plain = { version: 1 as const, keyVersion: 1, storeId: invocation.input.catalogStoreId, createdAt: updatedAt,
    entries: { [HINDSIGHT_SECRET_REFS.defaultModelApiKey]: { value, updatedAt } } };
  const sealed = sealCatalog(plain, key); const path = join(directory, "secret-catalog.bin"); writeFileSync(path, sealed);
  invocation.input.selection = [{ slot: "defaultModelApiKey", source: "catalog", updatedAt }];
  invocation.input.sealedEnvelopeSha256 = sha256(sealed);
  invocation.control.inputDigest = sha256(canonicalCapabilityInput(invocation.control.capabilityId, invocation.input));
  const registration = HindsightHostRegistrationSchema.parse(JSON.parse(readFileSync(new URL("../../../packages/shared/fixtures/protocol/hindsight-host-registration.windows.valid.json", import.meta.url), "utf8")));
  registration.coreDataDirectory = directory;
  const installation: VerifiedInstallation = { registration, registrationPath: join(directory, "registration.json"), owner: invocation.owner, validate: vi.fn() };
  vi.mocked(readCatalogKey).mockImplementation(async () => Uint8Array.from(key));
  return { directory, path, installation, invocation, key };
}

describe("read-only custody preparation", () => {
  it("authenticates TSC1 and returns only original safe identity without writing the catalog or exposing values", async () => {
    const h = await fixture(); const before = readFileSync(h.path);
    const result = await prepareCustody(h.invocation, h.installation, new AbortController().signal);
    expect(result).toMatchObject({ state: "prepared", deploymentReady: false, snapshotId: h.invocation.input.snapshotId });
    expect(readFileSync(h.path)).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("C1_FAKE_SENTINEL");
    expect(readCatalogKey).toHaveBeenCalledTimes(1);
  });

  it.each(["file", "configuration", "abort", "registration"])("rechecks %s after the key-source await", async (kind) => {
    const h = await fixture(); const controller = new AbortController();
    vi.mocked(readCatalogKey).mockImplementationOnce(async () => {
      await Promise.resolve();
      if (kind === "file") { const copy = join(h.directory, "replacement.bin"); writeFileSync(copy, readFileSync(h.path)); renameSync(copy, h.path); }
      if (kind === "configuration") vi.mocked(h.installation.validate).mockImplementation(() => { throw new CustodyError("snapshot-stale"); });
      if (kind === "abort") controller.abort();
      if (kind === "registration") h.installation.registration.installationId = "e".repeat(64);
      return Uint8Array.from(h.key);
    });
    expect(await prepareCustody(h.invocation, h.installation, controller.signal)).toMatchObject({ state: "unavailable", deploymentReady: false });
  });

  it("refuses wrong keys, stale metadata and oversized imported values with no private diagnostics", async () => {
    const h = await fixture();
    vi.mocked(readCatalogKey).mockResolvedValueOnce(generateCatalogKey());
    expect(await prepareCustody(h.invocation, h.installation, new AbortController().signal)).toMatchObject({ state: "unavailable", reason: "custody-locked" });
    h.invocation.input.selection[0] = { slot: "defaultModelApiKey", source: "catalog", updatedAt: "2025-01-01T00:00:00.000Z" };
    h.invocation.control.inputDigest = sha256(canonicalCapabilityInput(h.invocation.control.capabilityId, h.invocation.input));
    expect(await prepareCustody(h.invocation, h.installation, new AbortController().signal)).toMatchObject({ state: "unavailable", reason: "snapshot-stale" });
    const huge = await fixture("a".repeat(65_537));
    expect(await prepareCustody(huge.invocation, huge.installation, new AbortController().signal)).toMatchObject({ state: "unavailable", reason: "input-oversize" });
  });

  it("rejects requested store and input substitutions before touching a key source", async () => {
    const h = await fixture(); h.invocation.input.catalogStoreId = crypto.randomUUID();
    expect(await prepareCustody(h.invocation, h.installation, new AbortController().signal)).toMatchObject({ state: "unavailable", reason: "snapshot-stale" });
    expect(readCatalogKey).not.toHaveBeenCalled();
  });
});
