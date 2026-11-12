import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_COMMAND_DISCLOSURE_REVISION, type ConnectParams, type LocalAuthChallenge } from "@taki/shared";
import { authenticateOperator, recoverOperatorAuth, authenticatedOperatorDeviceId } from "./operator-auth.ts";
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

describe("native same-socket operator admission", () => {
  const deviceId = "550e8400-e29b-41d4-a716-446655440002";
  function nativeFixture() {
    const store = storage();
    const calls: ConnectParams[] = [];
    let refuse: "LOCAL_AUTH_UNAVAILABLE" | "LOCAL_AUTH_FAILED" | undefined;
    const proof = vi.fn(async () => "03".repeat(32));
    const native = { identity: async () => deviceId, proof };
    const connect = vi.fn(async (params: ConnectParams) => {
      calls.push(params);
      if (refuse) return { ok: false as const, code: refuse, message: "refused" };
      if (params.localAuth?.kind === "begin") {
        const challenge: LocalAuthChallenge = { version: 1, coreId: "550e8400-e29b-41d4-a716-446655440000",
          instanceId: "550e8400-e29b-41d4-a716-446655440001", endpoint: "ws://127.0.0.1:8974",
          nonce: "01".repeat(32), clientNonce: params.localAuth.clientNonce, deviceId, role: "operator", expiresAt: Date.now() + 30_000,
          serverProof: "02".repeat(32) };
        return { ok: false as const, code: "LOCAL_AUTH_REQUIRED" as const, message: "proof", challenge };
      }
      return { ok: true as const, token: "native-token" };
    });
    return { store, calls, proof, native, client: { connect }, refuse: (code: typeof refuse) => { refuse = code; } };
  }

  it("verifies server on the existing socket before sending any saved token", async () => {
    const f = nativeFixture();
    const tokenKey = `taki.native-operator-token.${deviceId}`;
    f.store.setItem(tokenKey, "old-token");
    f.store.setItem("taki.operator-identity", "legacy identity retained");
    expect(await authenticateOperator({ client: f.client, deviceName: "Home", storage: f.store, native: f.native })).toMatchObject({ ok: true });
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]).not.toHaveProperty("token");
    expect(f.calls[1]).toMatchObject({ token: "old-token", localAuth: { kind: "proof" } });
    expect(f.proof).toHaveBeenCalledOnce();
    expect(f.store.getItem(tokenKey)).toBe("native-token");
    expect(authenticatedOperatorDeviceId(f.client)).toBe(deviceId);
    expect(f.store.getItem("taki.operator-identity")).toBe("legacy identity retained");
  });

  it("preserves credentials on helper failure, server spoof and explicit refusal", async () => {
    const f = nativeFixture();
    const tokenKey = `taki.native-operator-token.${deviceId}`;
    f.store.setItem(tokenKey, "old-token");
    f.refuse("LOCAL_AUTH_UNAVAILABLE");
    await expect(authenticateOperator({ client: f.client, deviceName: "Home", storage: f.store, native: f.native })).rejects.toThrow("重试");
    f.refuse(undefined);
    f.proof.mockRejectedValueOnce(new Error("server proof invalid"));
    await expect(authenticateOperator({ client: f.client, deviceName: "Home", storage: f.store, native: f.native })).rejects.toThrow("server proof invalid");
    expect(f.calls.every((params) => params.token === undefined)).toBe(true);
    f.refuse("LOCAL_AUTH_FAILED");
    expect(await authenticateOperator({ client: f.client, deviceName: "Home", storage: f.store, native: f.native })).toMatchObject({ ok: false });
    expect(f.store.getItem(tokenKey)).toBe("old-token");
  });
});
