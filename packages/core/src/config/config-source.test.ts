import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigListResultSchema } from "@taki/shared";
import { createConfigRepo, type ConfigRepo } from "../db/config-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createConfigSource, type ConfigSource } from "./config-source.ts";
import { CONFIG_KNOBS } from "./knob-registry.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function build(env: Record<string, string | undefined> = {}): { repo: ConfigRepo; source: ConfigSource } {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const repo = createConfigRepo(db);
  return { repo, source: createConfigSource({ env, repo }) };
}

function entry(source: ConfigSource, key: string) {
  return source.effectiveAll().find((row) => row.key === key);
}

describe("createConfigSource", () => {
  it("falls back to the built-in default when neither env nor store has the knob", () => {
    const { source } = build();
    expect(source.resolve("TAKI_MAX_STEPS")).toEqual({ value: 10, origin: "default" });
  });

  it("a stored value beats the default", () => {
    const { repo, source } = build();
    repo.upsert("TAKI_MAX_STEPS", 22);
    expect(source.resolve("TAKI_MAX_STEPS")).toEqual({ value: 22, origin: "stored" });
  });

  it("an application value beats an explicitly set environment fallback", () => {
    const { repo, source } = build({ TAKI_MAX_STEPS: "7" });
    repo.upsert("TAKI_MAX_STEPS", 22);
    expect(source.resolve("TAKI_MAX_STEPS")).toEqual({ value: 22, origin: "stored" });
    expect(source.env().TAKI_MAX_STEPS).toBe("22");
  });

  it.each([
    ["TAKI_AMBIENT_SCREENSHOT", "true", false],
    ["TAKI_INITIATIVE_JITTER_RATIO", "0.3", 0],
    ["TAKI_HINDSIGHT_POLICY_PROMPT", "environment prompt", ""],
  ] as const)("keeps the explicit falsy application value for %s", (key, fallback, value) => {
    const { repo, source } = build({ [key]: fallback });
    repo.upsert(key, value);
    expect(source.resolve(key)).toEqual({ value, origin: "stored" });
    expect(source.env()[key]).toBe(String(value));
    expect(entry(source, key)).toMatchObject({ value, stored: true, envLocked: false });
  });

  it("exposes an invalid stored value instead of silently taking a valid environment fallback", () => {
    const { repo, source } = build({ TAKI_MAX_STEPS: "7" });
    repo.upsert("TAKI_MAX_STEPS", "invalid stored input");
    expect(source.resolve("TAKI_MAX_STEPS")).toEqual({ value: "invalid stored input", origin: "stored" });
    expect(source.env().TAKI_MAX_STEPS).toBe("invalid stored input");
  });

  it("an empty env var counts as unset", () => {
    const { repo, source } = build({ TAKI_MAX_STEPS: "" });
    repo.upsert("TAKI_MAX_STEPS", 22);
    expect(source.resolve("TAKI_MAX_STEPS")).toEqual({ value: 22, origin: "stored" });
  });

  it("coerces env text by the knob's kind, and shows a bad value verbatim", () => {
    const { source } = build({ TAKI_AMBIENT_SCREENSHOT: "true", TAKI_WS_PORT: "1" });
    expect(source.resolve("TAKI_AMBIENT_SCREENSHOT")?.value).toBe(true);
    expect(source.resolve("TAKI_WS_PORT")?.value).toBe(1);
    expect(build({ TAKI_WS_PORT: "nope" }).source.resolve("TAKI_WS_PORT")?.value).toBe("nope");
    expect(build({ TAKI_AMBIENT_SCREENSHOT: "off" }).source.resolve("TAKI_AMBIENT_SCREENSHOT")?.value).toBe("off");
    expect(build({ TAKI_TRUST_LOOPBACK_OPERATOR: "  " }).source.resolve("TAKI_TRUST_LOOPBACK_OPERATOR"))
      .toEqual({ value: false, origin: "default" });
  });

  it("applies application precedence to timing rows and exposes editable panel metadata", () => {
    const { repo, source } = build({ TAKI_RPC_INTERACTIVE_TIMEOUT_MS: "17000" });
    repo.upsert("TAKI_RPC_INTERACTIVE_TIMEOUT_MS", 16_000);
    expect(source.resolve("TAKI_RPC_INTERACTIVE_TIMEOUT_MS")).toEqual({ value: 16_000, origin: "stored" });
    expect(entry(source, "TAKI_RPC_INTERACTIVE_TIMEOUT_MS")).toMatchObject({
      value: 16_000,
      envLocked: false,
      apply: "live",
      input: { kind: "int", min: 1 },
    });
  });

  it("ignores a stored row for an env-only knob", () => {
    const { repo, source } = build();
    repo.upsert("TAKI_DATA_DIR", "C:/somewhere-else");
    expect(source.resolve("TAKI_DATA_DIR")?.origin).toBe("default");
  });

  it("retains environment ownership only for the bootstrap data root", () => {
    const { repo, source } = build({ TAKI_DATA_DIR: "C:/bootstrap" });
    repo.upsert("TAKI_DATA_DIR", "C:/ignored-stored-root");
    expect(source.resolve("TAKI_DATA_DIR")).toEqual({ value: "C:/bootstrap", origin: "env" });
    expect(source.env().TAKI_DATA_DIR).toBe("C:/bootstrap");
    expect(entry(source, "TAKI_DATA_DIR")).toMatchObject({ value: "C:/bootstrap", envLocked: true, apply: "env-only" });
  });

  it("never treats a stray plaintext secret row as an authoritative credential", () => {
    const { repo, source } = build();
    repo.upsert("TAKI_PROVIDER_API_KEY", "stray-private-value");
    expect(source.resolve("TAKI_PROVIDER_API_KEY")).toEqual({ value: null, origin: "default" });
    expect(source.env().TAKI_PROVIDER_API_KEY).toBeUndefined();
    expect(entry(source, "TAKI_PROVIDER_API_KEY")).toMatchObject({ value: null, secretSet: false });
    expect(JSON.stringify(source.effectiveAll())).not.toContain("stray-private-value");
  });

  it("resolve returns undefined for a key outside the registry", () => {
    expect(build().source.resolve("TAKI_DEV_TRIGGER")).toBeUndefined();
  });

  describe("env()", () => {
    it("overlays stored values onto the process env for the loaders", () => {
      const { repo, source } = build({ PATH: "/bin" });
      repo.upsert("TAKI_MAX_STEPS", 22);
      repo.upsert("TAKI_AMBIENT_SCREENSHOT", true);

      const merged = source.env();
      expect(merged.TAKI_MAX_STEPS).toBe("22");
      expect(merged.TAKI_AMBIENT_SCREENSHOT).toBe("true");
      expect(merged.PATH).toBe("/bin"); // non-knob entries pass through untouched
    });

    it("overrides ordinary environment values but excludes bootstrap and secret rows", () => {
      const { repo, source } = build({ TAKI_MAX_STEPS: "7" });
      repo.upsert("TAKI_MAX_STEPS", 22);
      repo.upsert("TAKI_DATA_DIR", "C:/nope");
      repo.upsert("TAKI_PROVIDER_API_KEY", "leaked");

      const merged = source.env();
      expect(merged.TAKI_MAX_STEPS).toBe("22");
      expect(merged.TAKI_DATA_DIR).toBeUndefined();
      expect(merged.TAKI_PROVIDER_API_KEY).toBeUndefined();
    });
  });

  describe("effectiveAll()", () => {
    it("lists every knob, and its values match resolve()", () => {
      const { repo, source } = build({ TAKI_WS_PORT: "9000" });
      repo.upsert("TAKI_MAX_STEPS", 22);

      const entries = source.effectiveAll();
      expect(ConfigListResultSchema.safeParse({ entries }).success).toBe(true);
      expect(entries).toHaveLength(CONFIG_KNOBS.length);
      for (const row of entries) {
        if (row.secret) continue;
        expect({ key: row.key, value: row.value }).toEqual({ key: row.key, value: source.resolve(row.key)?.value ?? null });
      }
    });

    it("reports provenance flags per knob", () => {
      const { repo, source } = build({ TAKI_WS_PORT: "9000" });
      repo.upsert("TAKI_MAX_STEPS", 22);

      expect(entry(source, "TAKI_WS_PORT")).toMatchObject({ value: 9000, envLocked: false, stored: false });
      expect(entry(source, "TAKI_MAX_STEPS")).toMatchObject({ value: 22, envLocked: false, stored: true });
      expect(entry(source, "TAKI_DATA_DIR")).toMatchObject({ apply: "env-only", stored: false });
    });

    it("uses one complete storage snapshot without per-row database reads", () => {
      const { repo, source } = build({ TAKI_WS_PORT: "9000" });
      repo.upsert("TAKI_MAX_STEPS", 22);
      const all = vi.spyOn(repo, "all");
      const get = vi.spyOn(repo, "get");
      expect(source.effectiveAll()).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: "TAKI_MAX_STEPS", value: 22, stored: true }),
        expect.objectContaining({ key: "TAKI_WS_PORT", value: 9000, stored: false }),
      ]));
      expect(all).toHaveBeenCalledExactlyOnceWith();
      expect(get).not.toHaveBeenCalled();
    });

    it("masks secrets: presence only, never the value, set or unset", () => {
      const { source } = build({ TAKI_PROVIDER_API_KEY: "sk-secret" });

      expect(entry(source, "TAKI_PROVIDER_API_KEY")).toMatchObject({ secret: true, secretSet: true, value: null, default: null });
      expect(entry(source, "TAKI_UTILITY_API_KEY")).toMatchObject({ secret: true, secretSet: false, value: null });
      expect(JSON.stringify(source.effectiveAll())).not.toContain("sk-secret");
    });
  });
});
