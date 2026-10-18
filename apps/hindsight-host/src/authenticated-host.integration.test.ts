import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectResultSchema, type CanonicalApprovalRequest } from "@taki/shared";
import { HindsightHostRegistrationSchema } from "@taki/shared/hindsight-installation";
import { HINDSIGHT_SECRET_REFS, HindsightCustodyParamsSchema } from "@taki/shared/hindsight-custody";
import { generateCatalogKey } from "@taki/secret-catalog-codec";
import { createDeviceRegistry } from "../../../packages/core/src/devices/device-registry.ts";
import { createPairedDeviceStore } from "../../../packages/core/src/devices/paired-device-store.ts";
import { createConnectionRegistry } from "../../../packages/core/src/server/connection-registry.ts";
import { createMethodRegistry } from "../../../packages/core/src/server/method-registry.ts";
import { startWsServer } from "../../../packages/core/src/server/ws-server.ts";
import { connectMethod } from "../../../packages/core/src/server/methods/connect.ts";
import { capabilityChallengeMethod } from "../../../packages/core/src/server/methods/capability-challenge.ts";
import { capabilityRespondMethod } from "../../../packages/core/src/server/methods/capability-respond.ts";
import { hostCatalogPublishMethod } from "../../../packages/core/src/server/methods/host-catalog-publish.ts";
import { registerApprovalMethods } from "../../../packages/core/src/server/methods/approval-methods.ts";
import { createHostCatalogStore } from "../../../packages/core/src/hosts/host-catalog.ts";
import { createCapabilityBroker } from "../../../packages/core/src/capabilities/capability-broker.ts";
import { routeCapability } from "../../../packages/core/src/capabilities/route-capability.ts";
import { createSecretCatalogService } from "../../../packages/core/src/secrets/secret-catalog-service.ts";
import { createHindsightCustodyOwner } from "../../../packages/core/src/memory/hindsight/hindsight-custody-owner.ts";
import { createCaptureLogger } from "../../../packages/core/src/testing/capture-logger.ts";
import { testApproval, testGovernance } from "../../../packages/core/src/testing/capability-tool-harness.ts";
import { connectHostTransport, nodeConnectParams, serveCustodyHost } from "./host-client.ts";
import { prepareCustody } from "./prepare-custody.ts";
import { invocationFixture, preparedFixture } from "./custody-test-fixtures.ts";
import type { VerifiedInstallation } from "./installation.ts";

vi.mock("./prepare-custody.ts", () => ({ prepareCustody: vi.fn() }));
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.mocked(prepareCustody).mockReset(); });

describe("actual authenticated C1 Host route", () => {
  it("requires Node pairing, enforces ask/resume, accepts only broker evidence and retires on disconnect", async () => {
    const directory = mkdtempSync(join(tmpdir(), "taki-c1-wire-"));
    const capture = createCaptureLogger(); const methods = createMethodRegistry(); const connections = createConnectionRegistry();
    const catalogs = createHostCatalogStore(); const approval = testApproval(); const governance = testGovernance();
    const broker = createCapabilityBroker({ logger: capture.logger, approval }); const pairingCodes: string[] = [];
    const devices = createDeviceRegistry({ store: createPairedDeviceStore(join(directory, "fake-paired-devices.json")) });
    methods.register(connectMethod({ deviceRegistry: devices, connectionRegistry: connections, trustLoopbackOperator: true,
      onPairingCode: (value) => pairingCodes.push(value.code), onAutoTrust: () => undefined }));
    methods.register(hostCatalogPublishMethod(catalogs, connections));
    methods.register(capabilityChallengeMethod(broker, connections)); methods.register(capabilityRespondMethod(broker, connections));
    registerApprovalMethods(methods, approval);
    connections.onRemove((connection) => {
      approval.disconnect(connection); const state = connection.state;
      if (state.status === "authenticated" && state.host) {
        catalogs.retire(state.host.hostId, state.host.connectionGeneration);
        broker.cancelGeneration(state.host.hostId, state.host.connectionGeneration, "fixture disconnected");
      }
    });
    const server = await startWsServer({ host: "127.0.0.1", port: 0, registry: methods, connectionRegistry: connections, logger: capture.logger });
    const url = `ws://127.0.0.1:${server.port}`; const lifetime = new AbortController();
    cleanup.push(async () => { lifetime.abort(); await server.close(); rmSync(directory, { recursive: true, force: true }); });
    const registration = HindsightHostRegistrationSchema.parse(JSON.parse(readFileSync(new URL("../../../packages/shared/fixtures/protocol/hindsight-host-registration.windows.valid.json", import.meta.url), "utf8")));
    const paired = await connectHostTransport(url, lifetime.signal);
    await expect(paired.call("connect", nodeConnectParams(registration.executionHostId))).rejects.toBeDefined();
    expect(pairingCodes).toHaveLength(1); // Loopback operator trust never enrolls a Node.
    const result = ConnectResultSchema.parse(await paired.call("connect", { ...nodeConnectParams(registration.executionHostId), pairingCode: pairingCodes[0] }));
    expect(result.token).toBeTruthy(); paired.close(); await paired.closed;
    const installation: VerifiedInstallation = { registration, registrationPath: join(directory, "fixture-only.json"),
      owner: invocationFixture().owner, validate: () => undefined }; // This fixture proves transport, not OS installation.
    vi.mocked(prepareCustody).mockImplementation(async (invocation) => preparedFixture(invocation));
    const hostStop = new AbortController();
    const hostDone = serveCustodyHost(installation, { version: 1, deviceId: registration.executionHostId, coreUrl: url, token: result.token! }, hostStop.signal)
      .catch((error: unknown) => ({ failure: error }));
    cleanup.push(async () => { hostStop.abort(); expect(await hostDone).toBeUndefined(); });
    await expect.poll(() => catalogs.get(registration.executionHostId)?.connectionGeneration).toBe(2);
    const key = generateCatalogKey();
    const catalog = await createSecretCatalogService({ filePath: join(directory, "secret-catalog.bin"), storeId: registration.coreHostId,
      logger: capture.logger, keySource: { kind: "credentials-directory", canCreate: false, read: () => key, create: () => { throw new Error("no key creation"); } } });
    catalog.set(HINDSIGHT_SECRET_REFS.defaultModelApiKey, "C1A_FAKE_SENTINEL");
    const owner = createHindsightCustodyOwner({ coreHostId: registration.coreHostId, catalog,
      current: () => ({ registration, configurationDigest: "c".repeat(64), selection: [{ slot: "defaultModelApiKey", source: "catalog" }] }),
      isCurrent: (control) => catalogs.get(control.targetHostId)?.connectionGeneration === control.connectionGeneration,
      route: (request, interactive) => routeCapability({ registry: connections, catalogs, broker, logger: capture.logger, governance, approval, interactive }, request) });
    methods.register({ method: "memory.hindsight.custody.prepare", roles: ["operator"], paramsSchema: HindsightCustodyParamsSchema,
      handler: async (_params, context) => (await owner.prepare({ connection: context.connection })).status });
    expect((await owner.prepare()).status).toMatchObject({ state: "unavailable", reason: "approval-required" });
    expect(prepareCustody).not.toHaveBeenCalled();
    const operator = await connectHostTransport(url, lifetime.signal); cleanup.push(async () => { operator.close(); await operator.closed; });
    await operator.call("connect", { deviceId: crypto.randomUUID(), deviceName: "fixture operator", role: "operator", capabilities: [] });
    await expect(operator.call("capability.respond", { requestId: crypto.randomUUID(), state: "completed", output: { trusted: true } })).rejects.toBeDefined();
    await expect(operator.call("memory.hindsight.custody.prepare", { receipt: { trusted: true } })).rejects.toBeDefined();
    const asks: CanonicalApprovalRequest[] = []; operator.notifications((method, params) => { if (method === "approval.request") asks.push(params as CanonicalApprovalRequest); });
    const pending = operator.call("memory.hindsight.custody.prepare", {});
    await expect.poll(() => asks.length).toBe(1);
    expect(prepareCustody).not.toHaveBeenCalled();
    expect(await operator.call("approval.respond", { approvalId: asks[0]!.approvalId, choice: "allow_once", expectedApprovalGeneration: approval.approvalGeneration() })).toMatchObject({ status: "accepted" });
    expect(await pending).toMatchObject({ state: "prepared", deploymentReady: false });
    governance.setLevel("relaxed", governance.level().policyGeneration);
    const accepted = await owner.prepare(); expect(accepted.evidence).toBeDefined();
    expect(owner.validate(accepted.evidence!)).toBe(true); expect(owner.validate(structuredClone(accepted.evidence!))).toBe(false);
    const calls = vi.mocked(prepareCustody).mock.calls.length; hostStop.abort(); expect(await hostDone).toBeUndefined();
    await expect.poll(() => catalogs.get(registration.executionHostId)).toBeUndefined();
    expect(owner.validate(accepted.evidence!)).toBe(false);
    expect((await owner.prepare()).status.state).toBe("unavailable"); expect(prepareCustody).toHaveBeenCalledTimes(calls);
    expect(JSON.stringify(capture.records)).not.toContain("C1A_FAKE_SENTINEL");
    owner.dispose();
  }, 15_000);
});
