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
});
