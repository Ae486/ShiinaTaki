import { afterEach, describe, expect, it } from "vitest";
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

  it("an explicitly set env var beats a stored value", () => {
    const { repo, source } = build({ TAKI_MAX_STEPS: "7" });
    repo.upsert("TAKI_MAX_STEPS", 22);
    expect(source.resolve("TAKI_MAX_STEPS")).toEqual({ value: 7, origin: "env" });
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
  });

  it("ignores a stored row for an env-only knob", () => {
    const { repo, source } = build();
    repo.upsert("TAKI_DATA_DIR", "C:/somewhere-else");
    expect(source.resolve("TAKI_DATA_DIR")?.origin).toBe("default");
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

    it("never lets a stored row shadow an env var, an env-only knob, or a secret", () => {
      const { repo, source } = build({ TAKI_MAX_STEPS: "7" });
      repo.upsert("TAKI_MAX_STEPS", 22);
      repo.upsert("TAKI_DATA_DIR", "C:/nope");
      repo.upsert("TAKI_PROVIDER_API_KEY", "leaked");

      const merged = source.env();
      expect(merged.TAKI_MAX_STEPS).toBe("7");
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

      expect(entry(source, "TAKI_WS_PORT")).toMatchObject({ value: 9000, envLocked: true, stored: false });
      expect(entry(source, "TAKI_MAX_STEPS")).toMatchObject({ value: 22, envLocked: false, stored: true });
      expect(entry(source, "TAKI_DATA_DIR")).toMatchObject({ apply: "env-only", stored: false });
    });

    it("masks secrets: presence only, never the value, set or unset", () => {
      const { source } = build({ TAKI_PROVIDER_API_KEY: "sk-secret" });

      expect(entry(source, "TAKI_PROVIDER_API_KEY")).toMatchObject({ secret: true, secretSet: true, value: null, default: null });
      expect(entry(source, "TAKI_VLM_API_KEY")).toMatchObject({ secret: true, secretSet: false, value: null });
      expect(JSON.stringify(source.effectiveAll())).not.toContain("sk-secret");
    });
  });
});
