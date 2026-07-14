import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPairedDeviceStore } from "./paired-device-store.ts";
import { PairingError, createDeviceRegistry, type DeviceRegistry } from "./device-registry.ts";

const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const identity = { deviceName: "laptop", role: "operator" as const };

const dirs: string[] = [];
function storePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-devreg-"));
  dirs.push(dir);
  return join(dir, "devices.json");
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

interface Clock {
  value: number;
}

function makeRegistry(path: string, clock: Clock): DeviceRegistry {
  return createDeviceRegistry({ store: createPairedDeviceStore(path), now: () => clock.value });
}

function pair(reg: DeviceRegistry): string {
  return reg.completePairing(DEVICE_ID, reg.beginPairing(DEVICE_ID), identity);
}

describe("createDeviceRegistry pairing", () => {
  it("T3 issues a 6-digit numeric pairing code", () => {
    const code = makeRegistry(storePath(), { value: 0 }).beginPairing(DEVICE_ID);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("T3 keeps a single pending entry per device (re-begin invalidates the old code)", () => {
    const reg = makeRegistry(storePath(), { value: 0 });
    const first = reg.beginPairing(DEVICE_ID);
    reg.beginPairing(DEVICE_ID);
    expect(() => reg.completePairing(DEVICE_ID, first, identity)).toThrow(PairingError);
  });

  it("T3 issues a token whose sha256 matches the stored hash (never plaintext at rest)", () => {
    const path = storePath();
    const token = pair(makeRegistry(path, { value: 0 }));

    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain(token); // the plaintext token never touches disk
    const storedHash = JSON.parse(raw).devices[0].tokenHash;
    expect(storedHash).toBe(createHash("sha256").update(token).digest("base64"));
  });

  it("T3 invalidates the pending pairing after 3 wrong codes", () => {
    const reg = makeRegistry(storePath(), { value: 0 });
    const code = reg.beginPairing(DEVICE_ID);
    const wrong = code === "000000" ? "999999" : "000000";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(() => reg.completePairing(DEVICE_ID, wrong, identity)).toThrow(PairingError);
    }
    // pending is gone — even the correct code now fails
    expect(() => reg.completePairing(DEVICE_ID, code, identity)).toThrow(PairingError);
  });

  it("T3 still accepts the correct code after a wrong attempt within the 3-attempt budget", () => {
    const reg = makeRegistry(storePath(), { value: 0 });
    const code = reg.beginPairing(DEVICE_ID);
    const wrong = code === "000000" ? "999999" : "000000";
    expect(() => reg.completePairing(DEVICE_ID, wrong, identity)).toThrow(PairingError);
    expect(reg.completePairing(DEVICE_ID, code, identity).length).toBeGreaterThan(0);
  });

  it("T3 re-begin after cap invalidation issues a fresh code that pairs", () => {
    const reg = makeRegistry(storePath(), { value: 0 });
    const first = reg.beginPairing(DEVICE_ID);
    const wrong = first === "000000" ? "999999" : "000000";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(() => reg.completePairing(DEVICE_ID, wrong, identity)).toThrow(PairingError);
    }
    const fresh = reg.beginPairing(DEVICE_ID);
    const token = reg.completePairing(DEVICE_ID, fresh, identity);
    expect(reg.verifyToken(DEVICE_ID, token, identity.role)).toBe(true);
  });

  it("T3 expires a pending pairing at 5 minutes (fake clock)", () => {
    const clock = { value: 0 };
    const reg = makeRegistry(storePath(), clock);
    const code = reg.beginPairing(DEVICE_ID);
    clock.value = PAIRING_TTL();
    expect(() => reg.completePairing(DEVICE_ID, code, identity)).toThrow(PairingError);
  });
});

describe("createDeviceRegistry trustDevice", () => {
  it("T-P3 issues a token that verifyToken accepts for the trusted operator role", () => {
    const reg = makeRegistry(storePath(), { value: 0 });
    const token = reg.trustDevice(DEVICE_ID, identity);
    expect(token.length).toBeGreaterThan(0);
    expect(reg.verifyToken(DEVICE_ID, token, "operator")).toBe(true);
  });

  it("T-P3 locks the role into the record (a stolen token can't privilege-swap to node)", () => {
    const reg = makeRegistry(storePath(), { value: 0 });
    const token = reg.trustDevice(DEVICE_ID, identity);
    expect(reg.verifyToken(DEVICE_ID, token, "node")).toBe(false);
  });

  it("T-P3 stores only the token hash (plaintext never touches disk), like pairing", () => {
    const path = storePath();
    const token = makeRegistry(path, { value: 0 }).trustDevice(DEVICE_ID, identity);
    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain(token);
    expect(JSON.parse(raw).devices[0].tokenHash).toBe(createHash("sha256").update(token).digest("base64"));
  });

  it("T-P3 token survives a registry restart over the same store", () => {
    const path = storePath();
    const token = makeRegistry(path, { value: 0 }).trustDevice(DEVICE_ID, identity);
    expect(makeRegistry(path, { value: 0 }).verifyToken(DEVICE_ID, token, "operator")).toBe(true);
  });
});

describe("createDeviceRegistry verifyToken", () => {
  it("T3 verifies a freshly issued token for the paired role", () => {
    const reg = makeRegistry(storePath(), { value: 0 });
    expect(reg.verifyToken(DEVICE_ID, pair(reg), "operator")).toBe(true);
  });

  it("T3 rejects a wrong token", () => {
    const reg = makeRegistry(storePath(), { value: 0 });
    pair(reg);
    expect(reg.verifyToken(DEVICE_ID, "wrong-token", "operator")).toBe(false);
  });

  it("T3 rejects an unknown device", () => {
    const reg = makeRegistry(storePath(), { value: 0 });
    expect(reg.verifyToken(DEVICE_ID, "any", "operator")).toBe(false);
  });

  it("T3 rejects a role mismatch (privilege swap with a stolen token)", () => {
    const reg = makeRegistry(storePath(), { value: 0 });
    const token = pair(reg);
    expect(reg.verifyToken(DEVICE_ID, token, "node")).toBe(false);
  });

  it("T3 verifies the same token from a fresh registry over the same store (restart survival)", () => {
    const path = storePath();
    const token = pair(makeRegistry(path, { value: 0 }));
    expect(makeRegistry(path, { value: 0 }).verifyToken(DEVICE_ID, token, "operator")).toBe(true);
  });
});

// Mirror of the registry's internal TTL (5 min) — kept local so the test states its own expectation.
function PAIRING_TTL(): number {
  return 5 * 60 * 1000;
}
