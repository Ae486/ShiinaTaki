import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOrCreateIdentity, saveToken } from "./device-identity.ts";

const dirs: string[] = [];
function identityPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-cli-id-"));
  dirs.push(dir);
  return join(dir, "cli-device.json");
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe("loadOrCreateIdentity", () => {
  it("T10 mints a uuid deviceId with no token on first run", () => {
    const identity = loadOrCreateIdentity(identityPath());
    expect(identity.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(identity.token).toBeUndefined();
  });

  it("T10 keeps the deviceId stable across loads", () => {
    const path = identityPath();
    const first = loadOrCreateIdentity(path);
    expect(loadOrCreateIdentity(path).deviceId).toBe(first.deviceId);
  });

  it("T10 persists a token that a later load reads back", () => {
    const path = identityPath();
    const { deviceId } = loadOrCreateIdentity(path);
    saveToken(path, "tok-123");
    expect(loadOrCreateIdentity(path)).toEqual({ deviceId, token: "tok-123" });
  });
});
