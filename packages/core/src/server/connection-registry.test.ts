import { describe, expect, it } from "vitest";
import { createConnectionRegistry } from "./connection-registry.ts";

describe("createConnectionRegistry", () => {
  it("creates connections in the awaiting state and tracks them", () => {
    const registry = createConnectionRegistry();
    const connection = registry.create();
    expect(connection.state.status).toBe("awaiting");
    expect(registry.list()).toContain(connection);
  });

  it("authenticate records deviceId, role and a defensive copy of capabilities", () => {
    const registry = createConnectionRegistry();
    const connection = registry.create();
    const capabilities = ["screenshot"];
    registry.authenticate(connection, { deviceId: "d1", role: "node", capabilities });
    capabilities.push("exec"); // mutating the caller's array must not leak into the connection

    expect(connection.state).toEqual({
      status: "authenticated",
      deviceId: "d1",
      role: "node",
      capabilities: ["screenshot"],
    });
  });

  it("remove drops the connection from the tracked set", () => {
    const registry = createConnectionRegistry();
    const connection = registry.create();
    registry.remove(connection);
    expect(registry.list()).not.toContain(connection);
  });

  it("findNodeForCapability returns the first authenticated node declaring the capability", () => {
    const registry = createConnectionRegistry();
    const operator = registry.create();
    registry.authenticate(operator, { deviceId: "op", role: "operator", capabilities: [] });
    const other = registry.create();
    registry.authenticate(other, { deviceId: "n0", role: "node", capabilities: ["clipboard"] });
    const node = registry.create();
    registry.authenticate(node, { deviceId: "n1", role: "node", capabilities: ["screenshot"] });

    expect(registry.findNodeForCapability("screenshot")).toBe(node);
    expect(registry.findNodeForCapability("exec")).toBeUndefined();
  });

  it("ignores an awaiting (unauthenticated) connection when routing a capability", () => {
    const registry = createConnectionRegistry();
    const awaiting = registry.create();
    void awaiting;
    expect(registry.findNodeForCapability("screenshot")).toBeUndefined();
  });

  it("notifies onRemove listeners with the removed connection", () => {
    const registry = createConnectionRegistry();
    const removed: unknown[] = [];
    registry.onRemove((connection) => removed.push(connection));
    const connection = registry.create();
    registry.remove(connection);
    expect(removed).toEqual([connection]);
  });
});
