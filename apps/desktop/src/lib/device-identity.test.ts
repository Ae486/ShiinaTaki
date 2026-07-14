/**
 * INPUT:  a fake IdentityStorage (Map-backed) exercising mint / read-back / token save / corruption.
 * OUTPUT: assertions that the deviceId is minted once and stable, tokens persist, and a corrupt record re-mints.
 * POS:    unit test for the operator device identity (F1). Node-safe (injected storage, no localStorage). Exempt from caps.
 */

import { describe, expect, it } from "vitest";
import { loadOrCreateIdentity, saveToken, type IdentityStorage } from "./device-identity.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeStorage(): IdentityStorage {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

describe("operator device identity", () => {
  it("mints a UUID once and reads it back unchanged", () => {
    const storage = fakeStorage();
    const first = loadOrCreateIdentity(storage);
    const second = loadOrCreateIdentity(storage);
    expect(first.deviceId).toMatch(UUID);
    expect(second.deviceId).toBe(first.deviceId);
    expect(first.token).toBeUndefined();
  });

  it("persists a token alongside the existing deviceId", () => {
    const storage = fakeStorage();
    const { deviceId } = loadOrCreateIdentity(storage);
    saveToken("tok-1", storage);
    expect(loadOrCreateIdentity(storage)).toEqual({ deviceId, token: "tok-1" });
  });

  it("drops a corrupt record and re-mints (one extra pairing, never a stuck client)", () => {
    const storage = fakeStorage();
    storage.setItem("taki.operator-identity", "{ not json");
    expect(loadOrCreateIdentity(storage).deviceId).toMatch(UUID);
  });
});
