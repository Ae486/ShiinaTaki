/**
 * INPUT:  a separately created/protected FAKE-only root, copied payload and actual non-secret token SID digest
 * OUTPUT: explicit fake TSC1 catalog, registration and fresh private invocation for the ignored Windows test
 * POS:    hindsight-host/tests — fixture preparation only; no production registration, key store or service access
 */
import { constants, copyFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { sealCatalog, sodiumReady } from "@taki/secret-catalog-codec";
import { HindsightHostRegistrationSchema } from "@taki/shared/hindsight-installation";
import { HINDSIGHT_SECRET_REFS, HindsightTrustedInvocationSchema } from "@taki/shared/hindsight-custody";
import { canonicalCapabilityInput } from "@taki/shared/host-input";
import { invocationFixture } from "../src/custody-test-fixtures.ts";
import { fileDigest, sha256 } from "../src/installed-files.ts";

const { values } = parseArgs({ options: {
  root: { type: "string" }, "token-user-sha256": { type: "string" }, payload: { type: "string", default: "payload-esm" },
  refresh: { type: "boolean", default: false },
} });
if (!values.root) throw new Error("explicit fixture root required");
const root = resolve(values.root);
if (!basename(root).startsWith("taki-c1a-fixture-") || readFileSync(join(root, ".c1a-owned-fixture"), "utf8") !== "C1A_FAKE_ONLY") {
  throw new Error("only the owned fake fixture may be written");
}
if (values.refresh) refresh();
else await initialize();

async function initialize(): Promise<void> {
  if (!values["token-user-sha256"] || !/^[a-f0-9]{64}$/.test(values["token-user-sha256"]) || values.payload !== basename(values.payload)) {
    throw new Error("explicit actual token digest and local payload name required");
  }
  const installationRoot = join(root, values.payload);
  const runtime = join(root, "node.exe");
  copyFileSync(process.execPath, runtime, constants.COPYFILE_EXCL);
  const coreDataDirectory = join(root, "fake-core-data");
  mkdirSync(coreDataDirectory);
  symlinkSync(coreDataDirectory, join(root, "catalog-junction"), "junction");
  const registration = HindsightHostRegistrationSchema.parse({
    version: 1, installationId: sha256("C1A_FAKE_ONLY"), manifestSha256: fileDigest(join(installationRoot, "manifest.json")),
    installationRoot, runtime: { path: runtime, sha256: fileDigest(runtime), version: process.version },
    coreHostId: "11111111-1111-4111-8111-111111111111", catalogStoreId: "11111111-1111-4111-8111-111111111111",
    executionHostId: "22222222-2222-4222-8222-222222222222", catalogKeyVersion: 1, coreDataDirectory,
    custody: { kind: "windows-keyring", service: "TakiAgent", account: "secret-catalog-master-key-v1",
      tokenUserSha256: values["token-user-sha256"],
      adapter: { path: join(installationRoot, "bin/taki-secret-key.exe"), sha256: fileDigest(join(installationRoot, "bin/taki-secret-key.exe")) } },
  });
  await sodiumReady;
  const updatedAt = "2026-10-13T00:00:00.000Z";
  const sealed = sealCatalog({ version: 1, keyVersion: 1, storeId: registration.catalogStoreId, createdAt: updatedAt,
    entries: { [HINDSIGHT_SECRET_REFS.defaultModelApiKey]: { value: "C1A_FAKE_SENTINEL", updatedAt } } }, new Uint8Array(32).fill(0xa5));
  writeFileSync(join(coreDataDirectory, "secret-catalog.bin"), sealed, { flag: "wx" });
  writeFileSync(join(root, "registration.json"), JSON.stringify(registration), { flag: "wx" });
  const invocation = invocationFixture();
  invocation.owner = { kind: "windows-token", tokenUserSha256: values["token-user-sha256"] };
  invocation.input.installationId = registration.installationId;
  invocation.input.sealedEnvelopeSha256 = sha256(sealed);
  invocation.input.selection = [{ slot: "defaultModelApiKey", source: "catalog", updatedAt }];
  invocation.control.inputDigest = sha256(canonicalCapabilityInput(invocation.control.capabilityId, invocation.input));
  writeFileSync(join(root, "invocation.json"), JSON.stringify(HindsightTrustedInvocationSchema.parse(invocation)), { flag: "wx" });
  writeFileSync(join(root, "preload.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync(new URL("./preload-ran", import.meta.url), "UNSAFE_PRELOAD");\n', { flag: "wx" });
}

function refresh(): void {
  const path = join(root, "invocation.json");
  const invocation = HindsightTrustedInvocationSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  invocation.control.dispatchedAt = new Date().toISOString();
  invocation.control.deadlineAt = new Date(Date.now() + 90_000).toISOString();
  writeFileSync(path, JSON.stringify(invocation));
}
