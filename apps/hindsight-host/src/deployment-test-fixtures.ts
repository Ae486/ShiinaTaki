/**
 * INPUT:  explicitly owned scratch root, fake adapter and generated test-only values
 * OUTPUT: fake encrypted Catalog, non-secret registration and current C2 invocations
 * POS:    hindsight-host/testing — constructs test data only; does not assert Windows installation trust
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sealCatalog, sodiumReady } from "@taki/secret-catalog-codec";
import { HINDSIGHT_SECRET_REFS, type HindsightCredentialSlot, type HindsightFixedSelection } from "@taki/shared/hindsight-custody";
import { HindsightHostRegistrationSchema } from "@taki/shared/hindsight-installation";
import { canonicalHostGovernanceProjection } from "@taki/shared/host-control";
import { canonicalCapabilityInput } from "@taki/shared/host-input";
import { GOVERNANCE_REGISTRY_REVISION } from "@taki/shared/governance";
import { DeploymentInvocationSchema, HindsightDeploymentRegistrationV1Schema,
  type DeploymentEffectV1, type DeploymentPlanV1, type CustodyLinkV1, type DeploymentInvocation } from "@taki/shared/hindsight-deployment";
import { invocationFixture } from "./custody-test-fixtures.ts";
import { fileDigest, sha256 } from "./installed-files.ts";
import { prepareDeploymentKeyAdapter } from "../test-fixtures/deployment-key-adapter-fixture.ts";

export async function deploymentFixture(root: string, keyAdapter: string | undefined, options: {
  invalid?: HindsightCredentialSlot; inherited?: boolean;
} = {}) {
  keyAdapter ??= prepareDeploymentKeyAdapter(root);
  for (const name of ["catalog", "state", "state/docker-config", "native"]) mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, ".c2a-owned-fixture"), "C2A_FAKE_ONLY");
  writeFileSync(join(root, "native", ".c2a-owned-fixture"), "C2A_FAKE_ONLY");
  writeFileSync(join(root, "native", ".env"), "C2A_DOTENV_POISON=must_not_load\n");
  writeFileSync(join(root, "state", "deployment.json"), JSON.stringify({ version: 1, revision: 0, state: "vacant" }));
  writeFileSync(join(root, "state", "deployment.lock"), "");
  const initial = invocationFixture();
  const registration = HindsightHostRegistrationSchema.parse(JSON.parse(readFileSync(new URL(
    "../../../packages/shared/fixtures/protocol/hindsight-host-registration.windows.valid.json", import.meta.url), "utf8")));
  registration.installationRoot = resolve(root);
  registration.coreDataDirectory = join(root, "catalog");
  registration.runtime.path = process.execPath;
  if (registration.custody.kind !== "windows-keyring") throw new Error("expected Windows fixture");
  registration.custody.adapter = { path: keyAdapter, sha256: fileDigest(keyAdapter) };
  const updatedAt = new Date().toISOString();
  const values = Object.fromEntries((Object.keys(HINDSIGHT_SECRET_REFS) as HindsightCredentialSlot[])
    .map((slot) => [slot, slot === options.invalid ? `GENERATED_NONMATCHING_${randomBytes(8).toString("hex")}` : `C2A_FAKE_${randomBytes(32).toString("hex")}`]));
  const selection: HindsightFixedSelection = (Object.keys(HINDSIGHT_SECRET_REFS) as HindsightCredentialSlot[]).map((slot) =>
    options.inherited && (slot === "retainModelApiKey" || slot === "reflectModelApiKey" || slot === "consolidationModelApiKey")
      ? { slot, source: "inherit-default" } : { slot, source: "catalog" });
  await sodiumReady;
  const sealed = sealCatalog({ version: 1, keyVersion: 1, storeId: registration.catalogStoreId, createdAt: updatedAt,
    entries: Object.fromEntries(Object.entries(HINDSIGHT_SECRET_REFS).map(([slot, ref]) => [ref, { value: values[slot]!, updatedAt }])) }, new Uint8Array(32).fill(0xa5));
  writeFileSync(join(root, "catalog", "secret-catalog.bin"), sealed);
  initial.input.sealedEnvelopeSha256 = sha256(sealed);
  initial.input.selection = selection.map((entry) => entry.source === "catalog" ? { ...entry, updatedAt } : entry);
  const custodyOperation = randomUUID();
  const custody: CustodyLinkV1 = { input: initial.input, deadlineAt: initial.control.deadlineAt, mapping: {
    coreOperationId: custodyOperation, brokerOperationId: custodyOperation, coreAttemptId: randomUUID(),
    hostAttemptId: randomUUID(), requestId: randomUUID(), inputDigest: sha256(canonicalCapabilityInput("hindsight-custody", initial.input)),
  } };
  const deploymentRegistration = HindsightDeploymentRegistrationV1Schema.parse({ version: 1, installationId: registration.installationId,
    coreHostId: registration.coreHostId, executionHostId: registration.executionHostId,
    docker: { path: keyAdapter, sha256: fileDigest(keyAdapter), version: "fixture-1", endpoint: "npipe:////./pipe/dockerDesktopLinuxEngine", engineId: "C2A-FIXTURE" },
    image: { id: `sha256:${"e".repeat(64)}`, os: "linux", architecture: "amd64", consumer: "c2a-fake-v1", bootstrapVersion: 1 },
    stateDirectory: join(root, "state") });
  const registrationText = JSON.stringify(deploymentRegistration);
  writeFileSync(join(root, "installation.json"), JSON.stringify(registration));
  writeFileSync(join(root, "deployment-registration.json"), registrationText);
  const deploymentId = randomUUID();
  const plan: DeploymentPlanV1 = { version: 1, deploymentId, operationId: deploymentId, coreHostId: registration.coreHostId,
    executionHostId: registration.executionHostId, installationId: registration.installationId,
    deploymentRegistrationSha256: sha256(registrationText), engineId: deploymentRegistration.docker.engineId,
    imageId: deploymentRegistration.image.id, configurationDigest: initial.input.configurationDigest, consumer: "c2a-fake-v1", storage: "new-named-volume" };
  return { root, registration, deploymentRegistration, plan, custody, values, selection, owner: initial.owner };
}
export type DeploymentFixture = Awaited<ReturnType<typeof deploymentFixture>>;

export function deploymentInvocation(fixture: DeploymentFixture, action: "create" | "start" | "inject" | "observe",
  resource: { containerId?: string; startupId?: string } = {}): DeploymentInvocation {
  const original = invocationFixture();
  const capabilityId = action === "observe" ? "hindsight-deployment-observe" : "hindsight-deployment";
  const input = action === "observe" ? { version: 1 as const, deploymentId: fixture.plan.deploymentId }
    : { version: 1, action, plan: fixture.plan, custody: fixture.custody, ...resource } as DeploymentEffectV1;
  const projection = { registryRevision: GOVERNANCE_REGISTRY_REVISION, descriptorRevision: 1, classifierRevision: 1,
    cells: (action === "observe" ? ["hindsight-deployment-observe:read"] : ["hindsight-deployment:create", "hindsight-deployment:inject", "hindsight-deployment:start"])
      .map((key) => ({ key, posture: "auto" as const })) };
  return DeploymentInvocationSchema.parse({ version: 1, requestId: randomUUID(), owner: fixture.owner, input,
    control: { ...original.control, runId: fixture.plan.deploymentId, operationId: fixture.plan.operationId,
      coreAttemptId: randomUUID(), effectId: randomUUID(), attemptId: randomUUID(), targetHostId: fixture.plan.executionHostId,
      capabilityId, inputDigest: sha256(canonicalCapabilityInput(capabilityId, input)),
      governanceProjection: { ...projection, digest: sha256(canonicalHostGovernanceProjection(projection)) } } });
}
