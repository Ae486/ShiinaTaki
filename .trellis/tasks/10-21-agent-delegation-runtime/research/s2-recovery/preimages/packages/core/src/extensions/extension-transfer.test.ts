import { describe, expect, it, vi } from "vitest";
import { createHostCatalogStore } from "../hosts/host-catalog.ts";
import { routeExtensionTransfer } from "./extension-transfer.ts";

const HOST = "11111111-1111-4111-8111-111111111111";

describe("extension transfer adapter", () => {
  it("routes only an explicitly advertised and executable target Host capability", async () => {
    const catalogs = catalog(["skill.transfer"], ["skill.transfer"]);
    const route = vi.fn(async () => ({ ok: true }));
    await expect(routeExtensionTransfer({ catalogs, route }, {
      targetHostId: HOST,
      transferCapabilityId: "skill.transfer",
      input: { packageId: "opaque" },
    })).resolves.toEqual({ ok: true });
    expect(route).toHaveBeenCalledWith({
      capabilityId: "skill.transfer",
      input: { packageId: "opaque" },
      targetHostId: HOST,
    });
  });

  it("fails before dispatch when advertisement or executable capability is absent", async () => {
    const route = vi.fn();
    await expect(routeExtensionTransfer({ catalogs: catalog([], ["skill.transfer"]), route }, {
      targetHostId: HOST,
      transferCapabilityId: "skill.transfer",
      input: {},
    })).resolves.toMatchObject({ ok: false, code: "TRANSFER_NOT_ADVERTISED" });
    await expect(routeExtensionTransfer({ catalogs: catalog(["skill.transfer"], []), route }, {
      targetHostId: HOST,
      transferCapabilityId: "skill.transfer",
      input: {},
    })).resolves.toMatchObject({ ok: false, code: "TRANSFER_CAPABILITY_MISSING" });
    expect(route).not.toHaveBeenCalled();
  });
});

function catalog(transferCapabilityIds: string[], capabilityIds: string[]) {
  const store = createHostCatalogStore();
  store.publish({
    hostId: HOST,
    label: "Node",
    protocolVersion: 3,
    catalogSchemaVersion: 2,
    connectionGeneration: 1,
    catalogGeneration: 1,
    publishedAt: "2026-08-18T00:00:00.000Z",
    readiness: "ready",
    capabilities: capabilityIds.map((capabilityId) => ({
      capabilityId,
      execution: "effect" as const,
      cancellation: "non-cooperative" as const,
      governance: { descriptorRevision: 1, classifierId: "fixed-risk", classifierRevision: 1 },
    })),
    workspaces: [{ workspaceId: "workspace", rootLabel: "hidden", transferCapabilityIds }],
    skills: [],
    mcpServers: [],
  }, {
    hostId: HOST,
    protocolVersion: 3,
    catalogSchemaVersion: 2,
    connectionGeneration: 1,
  });
  return store;
}
