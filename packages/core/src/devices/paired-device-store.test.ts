import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPairedDeviceStore, type PairedDevice } from "./paired-device-store.ts";

const sample: PairedDevice = {
  deviceId: "550e8400-e29b-41d4-a716-446655440000",
  deviceName: "laptop",
  role: "operator",
  tokenHash: "aGFzaA==",
  pairedAt: "2026-07-09T00:00:00.000Z",
};

const dirs: string[] = [];
function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-devstore-"));
  dirs.push(dir);
  return join(dir, "devices.json");
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe("createPairedDeviceStore", () => {
  it("T2 treats a missing file as an empty store", () => {
    const store = createPairedDeviceStore(tempStorePath());
    expect(store.find(sample.deviceId)).toBeUndefined();
  });

  it("T2 round-trips a saved device across a fresh store instance (restart survival)", () => {
    const path = tempStorePath();
    createPairedDeviceStore(path).save(sample);
    expect(createPairedDeviceStore(path).find(sample.deviceId)).toEqual(sample);
  });

  it("T2 upserts (replaces) a device sharing the same deviceId", () => {
    const path = tempStorePath();
    const store = createPairedDeviceStore(path);
    store.save(sample);
    store.save({ ...sample, deviceName: "renamed" });
    expect(createPairedDeviceStore(path).find(sample.deviceId)?.deviceName).toBe("renamed");
  });

  it("T2 fails fast with a readable error on a corrupted file", () => {
    const path = tempStorePath();
    writeFileSync(path, "this is not json");
    expect(() => createPairedDeviceStore(path)).toThrow(/device store/);
  });

  it("T2 fails fast on valid JSON with the wrong shape (never degrades into an empty store)", () => {
    const path = tempStorePath();
    writeFileSync(path, JSON.stringify({ devices: [{ deviceId: "x" }] }));
    expect(() => createPairedDeviceStore(path)).toThrow(/malformed/);
  });

  it("failed durable enrollment never becomes trusted only in process memory", () => {
    const path = tempStorePath();
    const store = createPairedDeviceStore(path);
    mkdirSync(`${path}.tmp`);
    expect(() => store.save(sample)).toThrow();
    expect(store.find(sample.deviceId)).toBeUndefined();
    rmSync(`${path}.tmp`, { recursive: true });
    store.save(sample);
    mkdirSync(`${path}.tmp`);
    expect(() => store.save({ ...sample, tokenHash: "rejected" })).toThrow();
    expect(store.find(sample.deviceId)?.tokenHash).toBe(sample.tokenHash);
  });
});
