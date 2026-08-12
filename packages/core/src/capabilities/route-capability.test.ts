import { describe, expect, it, vi } from "vitest";
import type { CapabilityBroker } from "./capability-broker.ts";
import { createHostCatalogStore } from "../hosts/host-catalog.ts";
import { createConnectionRegistry } from "../server/connection-registry.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { routeCapability } from "./route-capability.ts";

const HOST_A = "11111111-1111-4111-8111-111111111111";
const HOST_B = "22222222-2222-4222-8222-222222222222";

describe("routeCapability", () => {
  it("routes an explicit target to exactly that Host when two Hosts advertise the capability", async () => {
    const harness = setup([HOST_A, HOST_B]);
    await expect(routeCapability(harness.deps, {
      capabilityId: "screenshot",
      input: { area: "full" },
      targetHostId: HOST_B,
    })).resolves.toEqual({
      ok: true,
      output: HOST_B,
    });
    expect(harness.request).toHaveBeenCalledOnce();
    expect(harness.request.mock.calls[0]?.[0]).toMatchObject({ hostId: HOST_B });
  });

  it("rejects an ambiguous legacy call instead of selecting by connection order", async () => {
    const harness = setup([HOST_A, HOST_B]);
    await expect(routeCapability(harness.deps, { capabilityId: "screenshot", input: {} })).resolves.toMatchObject({
      ok: false,
      code: "TARGET_HOST_REQUIRED",
    });
    expect(harness.request).not.toHaveBeenCalled();
  });

  it("rejects a legacy call when no routable Host advertises the capability", async () => {
    const harness = setup([]);
    await expect(routeCapability(harness.deps, { capabilityId: "screenshot", input: {} })).resolves.toMatchObject({
      ok: false,
      code: "NO_NODE",
    });
    expect(harness.request).not.toHaveBeenCalled();
  });
});

function setup(hostIds: string[]) {
  const registry = createConnectionRegistry();
  const catalogs = createHostCatalogStore();
  for (const hostId of hostIds) {
    const connection = registry.create(() => undefined);
    const provenance = registry.authenticate(connection, {
      deviceId: hostId,
      role: "node",
      capabilities: ["screenshot"],
      host: { protocolVersion: 1, catalogSchemaVersion: 1 },
    });
    catalogs.publish({
      hostId,
      label: "Test Host",
      protocolVersion: 1,
      catalogSchemaVersion: 1,
      connectionGeneration: 1,
      catalogGeneration: 1,
      publishedAt: "2026-08-12T00:00:00.000Z",
      readiness: "ready",
      capabilities: [{ capabilityId: "screenshot", execution: "read", cancellation: "cooperative" }],
      workspaces: [],
      skills: [],
      mcpServers: [],
    }, provenance!);
  }
  const request = vi.fn((target: { hostId: string }) => Promise.resolve({ ok: true as const, output: target.hostId }));
  const broker: CapabilityBroker = {
    request,
    resolve: () => ({ accepted: false, reason: "unknown_request" }),
    cancelGeneration: () => undefined,
  };
  const { logger } = createCaptureLogger();
  return { request, deps: { registry, catalogs, broker, logger } };
}
