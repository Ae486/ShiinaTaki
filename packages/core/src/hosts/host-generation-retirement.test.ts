import { describe, expect, it } from "vitest";
import type { CapabilityRequest, HostCatalogPublishParams } from "@taki/shared";
import { createCapabilityBroker } from "../capabilities/capability-broker.ts";
import { createConnectionRegistry } from "../server/connection-registry.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { fakeHost, testApproval } from "../testing/capability-tool-harness.ts";
import { createHostCatalogStore } from "./host-catalog.ts";
import { bindHostGenerationRetirement } from "./host-generation-retirement.ts";

const HOST_A = "11111111-1111-4111-8111-111111111111";
const HOST_B = "22222222-2222-4222-8222-222222222222";
const hostSelection = { protocolVersion: 2, catalogSchemaVersion: 2 };

describe("bindHostGenerationRetirement", () => {
  it("retires only the replaced Host generation before the old socket closes", async () => {
    const connections = createConnectionRegistry();
    const catalogs = createHostCatalogStore();
    const { logger } = createCaptureLogger();
    const broker = createCapabilityBroker({ logger, approval: testApproval() });
    bindHostGenerationRetirement({ connections, catalogs, broker });

    const oldA = connections.create();
    const liveB = connections.create();
    const provenanceA = connections.authenticate(oldA, hostIdentity(HOST_A));
    const provenanceB = connections.authenticate(liveB, hostIdentity(HOST_B));
    catalogs.publish(catalog(HOST_A), provenanceA!);
    catalogs.publish(catalog(HOST_B), provenanceB!);

    const pendingA = broker.request(target(HOST_A, () => undefined), {});
    let sentB: CapabilityRequest | undefined;
    const pendingB = broker.request(target(HOST_B, (_method, params) => (sentB = params as CapabilityRequest)), {});

    const replacementA = connections.create();
    connections.authenticate(replacementA, hostIdentity(HOST_A));

    expect(catalogs.get(HOST_A)).toBeUndefined();
    expect(catalogs.get(HOST_B)).toBeDefined();
    expect(connections.isCurrentHost(oldA)).toBe(false);
    expect(connections.isCurrentHost(replacementA)).toBe(true);
    await expect(pendingA).resolves.toMatchObject({ ok: false, code: "NODE_DISCONNECTED" });

    expect(broker.resolve({
      requestId: sentB!.requestId,
      control: sentB!.control,
      state: "completed",
      output: "still-live", governance: { descriptorRevision: 1, classifierRevision: 1, cellKey: "screenshot", effectivePosture: "auto", constraint: "none" },
    }, { hostId: HOST_B, connectionGeneration: 1 })).toEqual({ accepted: true });
    await expect(pendingB).resolves.toEqual({ ok: true, output: "still-live" });
  });
});

function hostIdentity(deviceId: string) {
  return { deviceId, role: "node" as const, capabilities: ["screenshot"], host: hostSelection };
}

function catalog(hostId: string): HostCatalogPublishParams {
  return {
    hostId,
    label: "Test Host",
    protocolVersion: 2,
    catalogSchemaVersion: 2,
    connectionGeneration: 1,
    catalogGeneration: 1,
    publishedAt: "2026-08-12T00:00:00.000Z",
    readiness: "ready",
    capabilities: [{ capabilityId: "screenshot", execution: "read", cancellation: "cooperative", governance: { descriptorRevision: 1, classifierId: "fixed-risk", classifierRevision: 1 } }],
    workspaces: [],
    skills: [],
    mcpServers: [],
  };
}

function target(hostId: string, notify: (method: string, params: unknown) => void) {
  return {
    hostId,
    connectionGeneration: 1,
    catalogGeneration: 1,
    descriptor: { capabilityId: "screenshot", execution: "read" as const, cancellation: "cooperative" as const, governance: { descriptorRevision: 1, classifierId: "fixed-risk", classifierRevision: 1 } },
    policyGeneration: 1,
    governanceProjection: { registryRevision: 1, descriptorRevision: 1, classifierRevision: 1, cells: [{ key: "screenshot", posture: "auto" as const }], digest: "a".repeat(64) },
    connection: fakeHost("screenshot"),
    notify,
    isCurrent: () => true,
  };
}
