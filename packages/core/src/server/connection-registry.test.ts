import { describe, expect, it, vi } from "vitest";
import { createConnectionRegistry } from "./connection-registry.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const hostSelection = { protocolVersion: 1, catalogSchemaVersion: 1 };

describe("createConnectionRegistry", () => {
  it("keeps operators legacy-compatible without Host negotiation", () => {
    const registry = createConnectionRegistry();
    const connection = registry.create();
    expect(registry.authenticate(connection, { deviceId: HOST, role: "operator", capabilities: [] })).toBeUndefined();
    expect(connection.state).toMatchObject({ status: "authenticated", role: "operator" });
  });

  it("assigns monotonically increasing generations per stable Host and retires the prior socket", () => {
    const registry = createConnectionRegistry();
    const closeFirst = vi.fn();
    const retired: number[] = [];
    registry.onRemove((connection) => {
      if (connection.state.status === "authenticated") retired.push(connection.state.host?.connectionGeneration ?? 0);
    });
    const first = registry.create(undefined, undefined, closeFirst);
    expect(
      registry.authenticate(first, { deviceId: HOST, role: "node", capabilities: ["screenshot"], host: hostSelection }),
    ).toMatchObject({ hostId: HOST, connectionGeneration: 1 });
    const second = registry.create();
    expect(
      registry.authenticate(second, { deviceId: HOST, role: "node", capabilities: ["screenshot"], host: hostSelection }),
    ).toMatchObject({ hostId: HOST, connectionGeneration: 2 });
    expect(closeFirst).toHaveBeenCalledOnce();
    expect(retired).toEqual([1]);
    expect(registry.isCurrentHost(first)).toBe(false);
    expect(registry.isCurrentHost(second)).toBe(true);
    expect(registry.findHost(HOST)).toBe(second);
  });

  it("removing a retired old socket cannot remove the replacement Host", () => {
    const registry = createConnectionRegistry();
    const first = registry.create();
    registry.authenticate(first, { deviceId: HOST, role: "node", capabilities: [], host: hostSelection });
    const second = registry.create();
    registry.authenticate(second, { deviceId: HOST, role: "node", capabilities: [], host: hostSelection });
    registry.remove(first);
    expect(registry.findHost(HOST)).toBe(second);
  });

  it("fires retirement listeners only once when replacement precedes the old close event", () => {
    const registry = createConnectionRegistry();
    const retired: unknown[] = [];
    registry.onRemove((connection) => retired.push(connection));
    const first = registry.create();
    registry.authenticate(first, { deviceId: HOST, role: "node", capabilities: [], host: hostSelection });
    const second = registry.create();
    registry.authenticate(second, { deviceId: HOST, role: "node", capabilities: [], host: hostSelection });
    registry.remove(first);
    expect(retired).toEqual([first]);
  });
});
