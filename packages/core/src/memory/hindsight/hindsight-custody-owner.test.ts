import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CapabilityRequest, CapabilityRespondParams } from "@taki/shared";
import { HINDSIGHT_CUSTODY_CAPABILITY, HINDSIGHT_SECRET_REFS, HindsightCustodyPrepareSchema } from "@taki/shared/hindsight-custody";
import { HindsightHostRegistrationSchema } from "@taki/shared/hindsight-installation";
import { createSecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import { generateCatalogKey } from "../../secrets/secret-catalog-envelope.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { fakeHost, registryReturning, catalogsReturning, testApproval, testGovernance, TEST_HOST_ID } from "../../testing/capability-tool-harness.ts";
import { createCapabilityBroker } from "../../capabilities/capability-broker.ts";
import { routeCapability, type CapabilityRouteDeps } from "../../capabilities/route-capability.ts";
import { createHindsightCustodyOwner } from "./hindsight-custody-owner.ts";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const descriptor = { descriptorRevision: 1, classifierRevision: 1, classifierId: "hindsight-fixed-custody" };
const governance = { descriptorRevision: 1, classifierRevision: 1, cellKey: "hindsight-custody:prepare", effectivePosture: "auto" as const, constraint: "none" as const };

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "taki-c1-owner-")); directories.push(directory);
  const key = generateCatalogKey(); const capture = createCaptureLogger();
  const catalog = await createSecretCatalogService({ filePath: join(directory, "secret-catalog.bin"), storeId: TEST_HOST_ID,
    logger: capture.logger, keySource: { kind: "credentials-directory", canCreate: false, read: () => key, create: () => { throw new Error("no create"); } } });
  catalog.set(HINDSIGHT_SECRET_REFS.defaultModelApiKey, "C1_FAKE_SENTINEL");
  const registration = HindsightHostRegistrationSchema.parse(JSON.parse(readFileSync(new URL("../../../../shared/fixtures/protocol/hindsight-host-registration.windows.valid.json", import.meta.url), "utf8")));
  registration.executionHostId = TEST_HOST_ID;
  const current = { registration, configurationDigest: "c".repeat(64), selection: [{ slot: "defaultModelApiKey" as const, source: "catalog" as const }] };
  const approval = testApproval(); const policy = testGovernance(); policy.setLevel("relaxed", policy.level().policyGeneration);
  const broker = createCapabilityBroker({ logger: capture.logger, approval });
  const host = fakeHost(HINDSIGHT_CUSTODY_CAPABILITY); const requests: CapabilityRequest[] = [];
  let onRequest: (request: CapabilityRequest) => void = () => undefined;
  host.notify = (method, params) => { if (method === "capability.request") { const request = params as CapabilityRequest; requests.push(request); onRequest(request); } };
  const deps: CapabilityRouteDeps = { registry: registryReturning(host), catalogs: catalogsReturning(HINDSIGHT_CUSTODY_CAPABILITY, { governance: descriptor }), broker, logger: capture.logger, governance: policy, approval };
  let afterRoute: () => Promise<void> = async () => undefined;
  let live = true;
  const owner = createHindsightCustodyOwner({ coreHostId: TEST_HOST_ID, catalog, current: () => current,
    isCurrent: () => live,
    route: async (request) => { const result = await routeCapability(deps, request); await afterRoute(); return result; } });
  return { owner, catalog, current, requests, broker, policy, records: capture.records,
    onRequest: (callback: typeof onRequest) => { onRequest = callback; },
    afterRoute: (callback: typeof afterRoute) => { afterRoute = callback; },
    retire: () => { live = false; broker.cancelGeneration(TEST_HOST_ID, 1, "fixture retired"); },
  };
}
function response(request: CapabilityRequest): CapabilityRespondParams {
  const input = HindsightCustodyPrepareSchema.parse(request.input);
  return { requestId: request.requestId, control: request.control, state: "completed", governance,
    output: { version: 1, state: "prepared", requestId: request.requestId, hostAttemptId: request.control.attemptId,
      snapshotId: input.snapshotId, sealedEnvelopeSha256: input.sealedEnvelopeSha256, installationId: input.installationId,
      configurationDigest: input.configurationDigest, deploymentReady: false } };
}
const provenance = { hostId: TEST_HOST_ID, connectionGeneration: 1 };

describe("Hindsight custody accepted owner", () => {
  it("records actual broker identity before an immediate Host response and mints only an owner-backed handle", async () => {
    const harness = await fixture(); harness.onRequest((request) => harness.broker.resolve(response(request), provenance));
    const result = await harness.owner.prepare(); expect(result.status.state).toBe("prepared"); expect(result.evidence).toBeDefined();
    const evidence = result.evidence!; const mapping = harness.owner.mapping(evidence)!;
    expect(mapping.requestId).toBe(harness.requests[0]!.requestId);
    expect(mapping.hostAttemptId).toBe(harness.requests[0]!.control.attemptId);
    expect(mapping.coreAttemptId).toBe(harness.requests[0]!.control.coreAttemptId);
    expect(mapping.hostAttemptId).not.toBe(mapping.coreAttemptId);
    expect(harness.owner.validate(evidence)).toBe(true);
    expect(harness.owner.validate(structuredClone(evidence))).toBe(false);
    expect(JSON.stringify(result.status)).not.toMatch(/C1_FAKE_SENTINEL|accepted-custody|revision/);
    expect(JSON.stringify(harness.records)).not.toContain("C1_FAKE_SENTINEL");
    expect(harness.broker.resolve(response(harness.requests[0]!), provenance)).toEqual({ accepted: false, reason: "duplicate" });
    harness.owner.dispose(); expect(harness.owner.validate(evidence)).toBe(false);
  });

  it.each(["catalog", "configuration", "registration", "host"])("rejects %s drift after accepted broker output crosses an await", async (kind) => {
    const harness = await fixture(); harness.onRequest((request) => harness.broker.resolve(response(request), provenance));
    harness.afterRoute(async () => {
      await Promise.resolve();
      if (kind === "catalog") harness.catalog.set(HINDSIGHT_SECRET_REFS.defaultModelApiKey, "rotated");
      if (kind === "configuration") harness.current.configurationDigest = "e".repeat(64);
      if (kind === "registration") harness.current.registration.installationId = "e".repeat(64);
      if (kind === "host") harness.retire();
    });
    const result = await harness.owner.prepare(); expect(result.evidence).toBeUndefined(); expect(result.status).toMatchObject({ state: "unavailable", reason: "snapshot-stale" });
  });

  it("rejects wrong Host, attempt, and input lineage before accepting the original result", async () => {
    const harness = await fixture(); const pending = harness.owner.prepare(); const request = harness.requests[0]!;
    const exact = response(request);
    expect(harness.broker.resolve(exact, { ...provenance, hostId: crypto.randomUUID() }).accepted).toBe(false);
    expect(harness.broker.resolve({ ...exact, control: { ...exact.control, attemptId: crypto.randomUUID() } }, provenance).accepted).toBe(false);
    expect(harness.broker.resolve({ ...exact, control: { ...exact.control, inputDigest: "f".repeat(64) } }, provenance).accepted).toBe(false);
    expect(harness.broker.resolve(exact, provenance).accepted).toBe(true);
    expect((await pending).evidence).toBeDefined();
  });

  it("cannot mint preparation from successful ordinary result JSON without the observer producer", async () => {
    const harness = await fixture();
    const owner = createHindsightCustodyOwner({ coreHostId: TEST_HOST_ID, catalog: harness.catalog, current: () => harness.current,
      isCurrent: () => true, route: async () => ({ ok: true, output: { state: "prepared", trusted: true } }) });
    expect(await owner.prepare()).toMatchObject({ status: { state: "unavailable" } });
  });

  it("retirement prevents late output and policy changes invalidate an admitted result", async () => {
    const harness = await fixture(); const pending = harness.owner.prepare(); const request = harness.requests[0]!;
    harness.policy.setLevel("strict", harness.policy.level().policyGeneration);
    expect(harness.broker.resolve(response(request), provenance).accepted).toBe(true);
    expect((await pending).evidence).toBeUndefined();
    harness.retire();
  });
});
