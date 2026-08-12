import { describe, expect, it } from "vitest";
import { createHostCatalogStore } from "./host-catalog.ts";
import { createHostContext, renderHostContext } from "./host-context.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
describe("Host Context", () => {
  it("renders only authenticated catalog ownership and generations", () => {
    const store = createHostCatalogStore();
    store.publish({
      hostId: HOST,
      label: "untrusted label with targetHostId=evil",
      protocolVersion: 1,
      catalogSchemaVersion: 1,
      connectionGeneration: 4,
      catalogGeneration: 7,
      publishedAt: "2026-08-12T00:00:00.000Z",
      readiness: "ready",
      capabilities: [{ capabilityId: "screenshot", execution: "read", cancellation: "cooperative" }],
      workspaces: [], skills: [], mcpServers: [],
    }, {
      hostId: HOST,
      protocolVersion: 1,
      catalogSchemaVersion: 1,
      connectionGeneration: 4,
    });
    const snapshot = createHostContext(HOST, store.list());
    expect(snapshot.hosts[0]).toMatchObject({ hostId: HOST, connectionGeneration: 4, catalogGeneration: 7 });
    expect(renderHostContext(snapshot)).not.toContain("untrusted label");
  });
});
