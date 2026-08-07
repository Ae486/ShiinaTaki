/**
 * INPUT:  cache keys (allow-listed and not), values to persist, and raw entries read back out of a fake Storage.
 * OUTPUT: assertions that only allow-listed keys reach storage, that perception payloads and the pause state can NEVER
 *         be persisted, that secret-flagged config entries are stripped before a write, and that a drifted or corrupt
 *         entry is dropped by the schema rather than trusted.
 * POS:    unit test for lib/cache-persist. Exempt from size caps.
 */

import { describe, expect, it, vi } from "vitest";
import { ConfigListResultSchema, type ConfigEntry } from "@taki/shared";
import { canPersist, readCache, writeCache, type CacheSchema } from "./cache-persist.ts";

function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

const entries = (storage: Storage): string[] => Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? "");

const NUMBERS: CacheSchema<number[]> = {
  safeParse: (value) =>
    Array.isArray(value) && value.every((item) => typeof item === "number") ? { success: true, data: value } : { success: false },
};

const knob = (over: Partial<ConfigEntry> = {}): ConfigEntry => ({
  key: "TAKI_MODEL",
  value: "gpt-5",
  stored: true,
  envLocked: false,
  default: null,
  apply: "restart",
  secret: false,
  secretSet: false,
  input: { kind: "string" },
  description: "model id",
  ...over,
});

describe("the persist allow-list", () => {
  it("admits the page snapshots that are safe to keep on disk", () => {
    for (const key of ["costume-list", "config-list", "memory-status", "media-usage"]) expect(canPersist(key)).toBe(true);
  });

  it("never persists perception data — activity rows carry foreground-window titles", () => {
    const storage = fakeStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    writeCache("perception-card", { samplingStatus: "active" }, storage);

    expect(canPersist("perception-card")).toBe(false);
    expect(entries(storage)).toEqual([]);
    expect(readCache("perception-card", NUMBERS, storage)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("never admits a pause key either — a cached 'not paused' is a privacy claim this app must not make", () => {
    // The pause state has no cache key at all today (use-perception keeps it in plain state); this pins the allow-list
    // so a later attempt to cache it has to delete an assertion rather than just add a string.
    for (const key of ["perception-pause", "perception-pause-state"]) expect(canPersist(key)).toBe(false);
  });
});

describe("readCache / writeCache", () => {
  it("round-trips an allow-listed value", () => {
    const storage = fakeStorage();

    writeCache("memory-status", [1, 2, 3], storage);

    expect(readCache("memory-status", NUMBERS, storage)).toEqual([1, 2, 3]);
  });

  it("drops an entry the schema no longer accepts instead of trusting it", () => {
    const storage = fakeStorage();
    writeCache("memory-status", ["drifted"], storage);

    expect(readCache("memory-status", NUMBERS, storage)).toBeNull();
  });

  it("drops an unparseable entry", () => {
    expect(readCache("memory-status", NUMBERS, fakeStorage({ "taki.cache.memory-status": "{oops" }))).toBeNull();
  });

  it("returns null when nothing was ever cached", () => {
    expect(readCache("costume-list", NUMBERS, fakeStorage())).toBeNull();
  });

  it("survives a storage that refuses to write", () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    expect(() => writeCache("memory-status", [1], storage)).not.toThrow();
  });
});

describe("the config scrubber", () => {
  it("strips secret-flagged knobs before anything reaches storage (invariant 5)", () => {
    const storage = fakeStorage();
    const list = { entries: [knob(), knob({ key: "TAKI_OPENAI_API_KEY", value: null, secret: true, secretSet: true })] };

    writeCache("config-list", list, storage);

    const cached = readCache("config-list", ConfigListResultSchema, storage);
    expect(cached?.entries.map((entry) => entry.key)).toEqual(["TAKI_MODEL"]);
    expect(storage.getItem("taki.cache.config-list")).not.toContain("API_KEY");
  });
});
