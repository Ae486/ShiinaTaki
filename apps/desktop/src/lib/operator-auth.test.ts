import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_COMMAND_DISCLOSURE_REVISION, type ConnectParams } from "@taki/shared";
import { authenticateOperator, recoverOperatorAuth } from "./operator-auth.ts";
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
    expect(calls[0]).toMatchObject({ capabilities: [], approvalCommandDisclosureRevision: APPROVAL_COMMAND_DISCLOSURE_REVISION });
    expect(calls[1]).toMatchObject({ deviceId: "device-1", deviceName: "taki-pet", token: "token-1" });
  });

  it("clears only a stale token so the next generation retries tokenless with the same device identity", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "device-1" });
    const identity = storage();
    const client = {
      connect: async () => ({ ok: true, token: "stale-token" } as const),
    };

    await authenticateOperator({ client, deviceName: "taki-home", storage: identity });
    expect(recoverOperatorAuth(identity)).toBe(true);
    expect(recoverOperatorAuth(identity)).toBe(false);

    const calls: ConnectParams[] = [];
    await authenticateOperator({
      client: {
        connect: async (params) => {
          calls.push(params);
          return { ok: true } as const;
        },
      },
      deviceName: "taki-home",
      storage: identity,
    });
    expect(calls).toEqual([{ deviceId: "device-1", deviceName: "taki-home", role: "operator", capabilities: [], approvalCommandDisclosureRevision: 1 }]);
  });

  it("keeps the existing credential after local display compatibility refusal", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "device-1" });
    const identity = storage();
    await authenticateOperator({ client: { connect: async () => ({ ok: true, token: "existing" }) }, deviceName: "home", storage: identity });
    const refused = { ok: false, code: null, message: "Core 版本不支持完整命令审批，请更新 Core 后重试。" } as const;
    const connect = vi.fn(async () => refused);
    expect(await authenticateOperator({ client: { connect }, deviceName: "home", storage: identity })).toEqual(refused);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ token: "existing", approvalCommandDisclosureRevision: 1 }));
    await authenticateOperator({ client: { connect }, deviceName: "home", storage: identity });
    expect(connect).toHaveBeenLastCalledWith(expect.objectContaining({ token: "existing" }));
  });
});
