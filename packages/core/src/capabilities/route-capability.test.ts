import { describe, expect, it, vi } from "vitest";
import type { CapabilityBroker } from "./capability-broker.ts";
import { createHostCatalogStore } from "../hosts/host-catalog.ts";
import { createConnectionRegistry } from "../server/connection-registry.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { routeCapability } from "./route-capability.ts";
import { testGovernance, testApproval } from "../testing/capability-tool-harness.ts";

const HOST_A = "11111111-1111-4111-8111-111111111111";
const HOST_B = "22222222-2222-4222-8222-222222222222";

describe("routeCapability", () => {
  it("forwards unattended Run identity and abort lifetime without inventing an operator", async () => {
    const harness = setup([HOST_A]);
    const controller = new AbortController();
    await routeCapability(harness.deps, { capabilityId: "screenshot", input: {}, targetHostId: HOST_A,
      runId: "background-run", attemptId: "background-attempt", signal: controller.signal });
    expect(harness.request.mock.calls[0]?.[0]).toMatchObject({ signal: controller.signal, operator: undefined });
    expect(harness.request.mock.calls[0]?.[2]).toMatchObject({ runId: "background-run", coreAttemptId: "background-attempt" });
  });
  it("routes an explicit target to exactly that Host when two Hosts advertise the capability", async () => {
    const harness = setup([HOST_A, HOST_B]);
    await expect(routeCapability(harness.deps, {
      capabilityId: "screenshot",
      input: { area: "full" },
      targetHostId: HOST_B,
    })).resolves.toMatchObject({
      ok: true,
      output: HOST_B,
      provenance: { hostId: HOST_B, connectionGeneration: 1, catalogGeneration: 1 },
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

  it("returns the actual pre-await dispatch binding and keeps its currentness tied to that exact socket", async () => {
    const harness = setup([HOST_A]);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    harness.request.mockImplementationOnce(async (target) => {
      await pending;
      return { ok: true, output: target.hostId };
    });
    const routed = routeCapability(harness.deps, { capabilityId: "screenshot", input: {} });
    const replacement = harness.deps.registry.create(() => undefined);
    harness.deps.registry.authenticate(replacement, {
      deviceId: HOST_A, role: "node", capabilities: ["screenshot"],
      host: { protocolVersion: 2, catalogSchemaVersion: 2 },
    });
    finish();
    const result = await routed;
    expect(result).toMatchObject({ ok: true, provenance: { hostId: HOST_A, connectionGeneration: 1, catalogGeneration: 1 } });
    if (!result.ok) throw new Error("fixture route failed");
    expect(result.provenance?.isCurrent()).toBe(false);
  });

  it("retains a live provenance predicate after settlement instead of checking only at return", async () => {
    const harness = setup([HOST_A]);
    const result = await routeCapability(harness.deps, { capabilityId: "screenshot", input: {} });
    if (!result.ok) throw new Error("fixture route failed");
    expect(result.provenance?.isCurrent()).toBe(true);
    harness.deps.registry.remove(harness.deps.registry.findHost(HOST_A)!);
    expect(result.provenance?.isCurrent()).toBe(false);
    expect(result.provenance?.connectionGeneration).toBe(1);
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
      host: { protocolVersion: 2, catalogSchemaVersion: 2 },
    });
    catalogs.publish({
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
    }, provenance!);
  }
  const request = vi.fn<CapabilityBroker["request"]>((target) => Promise.resolve({ ok: true as const, output: target.hostId }));
  const broker: CapabilityBroker = {
    authorizeHindsightInjection: () => ({ state: "unavailable", reason: "denied" }),
    request,
    challenge: () => ({ accepted: false, reason: "unknown_request" }),
    resolve: () => ({ accepted: false, reason: "unknown_request" }),
    cancelGeneration: () => undefined,
  };
  const { logger } = createCaptureLogger();
  return { request, deps: { registry, catalogs, broker, logger, governance: testGovernance(), approval: testApproval() } };
}
