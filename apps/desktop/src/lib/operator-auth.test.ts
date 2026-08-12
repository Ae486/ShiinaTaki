import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectParams } from "@taki/shared";
import { authenticateOperator } from "./operator-auth.ts";
import type { IdentityStorage } from "./device-identity.ts";

function storage(): IdentityStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("authenticateOperator", () => {
  it("loads the newest stored credential on every generation and persists a replacement token", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "device-1" });
    const calls: ConnectParams[] = [];
    const client = {
      connect: async (params: ConnectParams) => {
        calls.push(params);
        return calls.length === 1 ? ({ ok: true, token: "token-1" } as const) : ({ ok: true } as const);
      },
    };
    const identity = storage();

    await authenticateOperator({ client, deviceName: "taki-pet", storage: identity });
    await authenticateOperator({ client, deviceName: "taki-pet", storage: identity });

    expect(calls[0]).not.toHaveProperty("token");
    expect(calls[1]).toMatchObject({ deviceId: "device-1", deviceName: "taki-pet", token: "token-1" });
  });
});
