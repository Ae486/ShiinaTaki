import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { type ConnectParams, type LocalAuthChallenge } from "@taki/shared";
import { createLogger } from "../logging/logger.ts";
import { createLocalConnectionAuth, localAuthMac } from "./local-connection-auth.ts";

const key = new Uint8Array(32).fill(7);
const coreId = "550e8400-e29b-41d4-a716-446655440000";
const deviceId = "550e8400-e29b-41d4-a716-446655440002";
const endpoint = "ws://127.0.0.1:8974";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-local-auth-"));
  dirs.push(dataDir);
  let now = 1;
  const auth = createLocalConnectionAuth({ dataDir, coreId, endpoint, env: {}, logger: createLogger("fatal"), now: () => now,
    keySource: { canCreate: true, read: () => key, create: async () => { throw new Error("unexpected create"); } } });
  const params: ConnectParams = { deviceId, deviceName: "Home", role: "operator", capabilities: [],
    localAuth: { kind: "begin", clientNonce: "02".repeat(32) } };
  const socket = {};
  return { auth, params, socket, dataDir, time: (value: number) => { now = value; } };
}

function proof(params: ConnectParams, challenge: LocalAuthChallenge): ConnectParams {
  return { ...params, localAuth: { kind: "proof", nonce: challenge.nonce, proof: localAuthMac(key, "client", challenge) } };
}

describe("same-socket native local connection authority", () => {
  it("matches the Rust HMAC fixture without exposing a reusable key in discovery", async () => {
    const { auth, dataDir } = fixture();
    const unsigned = { version: 1 as const, coreId, instanceId: "550e8400-e29b-41d4-a716-446655440001",
      endpoint, nonce: "01".repeat(32), clientNonce: "02".repeat(32), deviceId, role: "operator" as const, expiresAt: 30_001 };
    expect(localAuthMac(key, "server", unsigned)).toBe("f37286ea575712330d5b187b9a7a40a84b39a4b894e4a650739f45f3d53e9079");
    expect(localAuthMac(key, "client", unsigned)).toBe("df194023c31033e94eac024d43cf3810184bd3686be1a2d352db1ac5a6c39af7");
    const publish = auth.publishEndpoint;
    publish(endpoint);
    expect(JSON.parse(readFileSync(join(dataDir, "local-core.json"), "utf8"))).toEqual({
      version: 1, coreId, endpoint, instanceId: expect.any(String),
    });
  });

  it("admits one proof only on its original physical socket", async () => {
    const { auth, socket, params } = fixture();
    const challenge = (await auth.begin(socket, params))!;
    const final = proof(params, challenge);
    expect(auth.verify({}, final)).toBe(false);
    expect(auth.verify(socket, final)).toBe(true);
    expect(auth.verify(socket, final)).toBe(false);
  });

  it.each(["deviceId", "role", "deviceName", "capabilities", "host", "approvalCommandDisclosureRevision"])("binds offered %s", async (field) => {
    const { auth, socket, params } = fixture();
    const challenge = (await auth.begin(socket, params))!;
    const changed = { ...proof(params, challenge), [field]: field === "capabilities" ? ["exec"] : "changed" };
    expect(auth.verify(socket, changed)).toBe(false);
  });

  it("rejects expired, substituted, replaced and old-endpoint challenges", async () => {
    const f = fixture();
    const expired = (await f.auth.begin(f.socket, f.params))!;
    f.time(expired.expiresAt);
    expect(f.auth.verify(f.socket, proof(f.params, expired))).toBe(false);
    const old = (await f.auth.begin(f.socket, f.params))!;
    await f.auth.begin(f.socket, f.params);
    expect(f.auth.verify(f.socket, proof(f.params, old))).toBe(false);
    const replacement = (await f.auth.begin(f.socket, f.params))!;
    f.auth.publishEndpoint("ws://127.0.0.1:9000");
    expect(f.auth.verify(f.socket, proof(f.params, replacement))).toBe(false);
    const forged = (await f.auth.begin(f.socket, f.params))!;
    expect(f.auth.verify(f.socket, { ...f.params, localAuth: { kind: "proof", nonce: forged.nonce, proof: "00".repeat(32) } })).toBe(false);
    f.auth.close();
    expect(await f.auth.begin(f.socket, f.params)).toBeNull();
  });

  it("retries unavailable helper without replacing an existing credential", async () => {
    const f = fixture();
    let available = false;
    let creates = 0;
    let now = 0;
    const auth = createLocalConnectionAuth({ dataDir: f.dataDir, coreId, endpoint, env: {}, logger: createLogger("fatal"), now: () => now,
      keySource: { canCreate: true, read: () => available ? key : null,
        create: async () => { creates++; throw new Error("existing or inaccessible"); } } });
    expect(await auth.begin(f.socket, f.params)).toBeNull();
    available = true;
    now = 1_001;
    expect(await auth.begin(f.socket, f.params)).not.toBeNull();
    expect(creates).toBe(1);
  });

  it("keeps the current endpoint after descriptor publication fails", async () => {
    const f = fixture();
    mkdirSync(join(f.dataDir, "local-core.json"));
    expect(() => f.auth.publishEndpoint("ws://127.0.0.1:9000")).toThrow();
    expect((await f.auth.begin(f.socket, f.params))?.endpoint).toBe(endpoint);
    expect(readdirSync(f.dataDir)).toEqual(["local-core.json"]);
  });

  it("shares one pending credential load and never completes admission after disposal", async () => {
    const f = fixture();
    let resolveKey: (key: Uint8Array) => void = () => {};
    const pending = new Promise<Uint8Array>((resolve) => { resolveKey = resolve; });
    let reads = 0;
    const auth = createLocalConnectionAuth({ dataDir: f.dataDir, coreId, endpoint, env: {}, logger: createLogger("fatal"),
      keySource: { canCreate: false, read: () => { reads++; return pending; }, create: () => {} } });
    const one = auth.begin({}, f.params);
    const two = auth.begin({}, f.params);
    expect(reads).toBe(1);
    auth.close();
    resolveKey(key);
    expect(await one).toBeNull();
    expect(await two).toBeNull();
  });
});
