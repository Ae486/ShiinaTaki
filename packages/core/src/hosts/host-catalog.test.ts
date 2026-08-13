import { describe, expect, it } from "vitest";
import type { HostCatalogPublishParams } from "@taki/shared";
import { createHostCatalogStore } from "./host-catalog.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
function catalog(overrides: Partial<HostCatalogPublishParams> = {}): HostCatalogPublishParams {
  return {
    hostId: HOST,
    label: "Desktop",
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
    ...overrides,
  };
}
const provenance = { hostId: HOST, protocolVersion: 2, catalogSchemaVersion: 2, connectionGeneration: 1 };

describe("HostCatalogStore", () => {
  it("atomically publishes a complete routable snapshot", () => {
    const store = createHostCatalogStore();
    expect(store.publish(catalog(), provenance)).toEqual({ accepted: true });
    expect(store.hostsForCapability("screenshot")).toHaveLength(1);
  });

  it("rejects a stale same-connection catalog generation and retires only the matching generation", () => {
    const store = createHostCatalogStore();
    store.publish(catalog({ catalogGeneration: 2 }), provenance);
    expect(store.publish(catalog({ catalogGeneration: 1 }), provenance)).toEqual({ accepted: false, reason: "stale_generation" });
    store.retire(HOST, 2);
    expect(store.get(HOST)).toBeDefined();
    store.retire(HOST, 1);
    expect(store.get(HOST)).toBeUndefined();
  });

  it("rejects payload provenance that differs from the authenticated connection", () => {
    const store = createHostCatalogStore();
    expect(store.publish(catalog({ connectionGeneration: 2 }), provenance)).toEqual({
      accepted: false,
      reason: "stale_generation",
    });
  });

  it("defensively snapshots nested descriptor arrays", () => {
    const store = createHostCatalogStore();
    const candidate = catalog();
    store.publish(candidate, provenance);
    candidate.capabilities.push({ capabilityId: "exec", execution: "effect", cancellation: "non-cooperative", governance: { descriptorRevision: 1, classifierId: "exec-command", classifierRevision: 1 } });
    expect(store.hostsForCapability("exec")).toHaveLength(0);
  });
});
