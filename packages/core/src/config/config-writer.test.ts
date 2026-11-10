import { afterEach, describe, expect, it } from "vitest";
import type { ConfigChanged } from "@taki/shared";
import { createConfigRepo, type ConfigRepo } from "../db/config-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createConfigWriter, type ConfigWriter } from "./config-writer.ts";
import { createConfigSource } from "./config-source.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function build(env: Record<string, string | undefined> = {}): {
  repo: ConfigRepo;
  writer: ConfigWriter;
  changes: ConfigChanged[];
} {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const repo = createConfigRepo(db);
  const changes: ConfigChanged[] = [];
  return { repo, changes, writer: createConfigWriter({ env, repo, onChanged: (c) => changes.push(c) }) };
}

describe("createConfigWriter", () => {
  it("persists a valid value and reports its apply class", () => {
    const { repo, writer, changes } = build();

    expect(writer.set({ key: "TAKI_MAX_STEPS", value: 22 })).toEqual({
      ok: true,
      key: "TAKI_MAX_STEPS",
      value: 22,
      apply: "live",
      effectiveValue: 22,
      origin: "stored",
    });
    expect(repo.get("TAKI_MAX_STEPS")).toBe(22);
    expect(changes).toEqual([{ key: "TAKI_MAX_STEPS", value: 22 }]);
  });

  it("a null value deletes the row and still announces the change", () => {
    const { repo, writer, changes } = build();
    writer.set({ key: "TAKI_MAX_STEPS", value: 22 });

    expect(writer.set({ key: "TAKI_MAX_STEPS", value: null }).ok).toBe(true);
    expect(repo.get("TAKI_MAX_STEPS")).toBeNull();
    expect(changes.at(-1)).toEqual({ key: "TAKI_MAX_STEPS", value: null });
  });

  it.each([
    ["unknown-key", {}, { key: "TAKI_NOT_A_KNOB", value: 1 }],
    ["invalid-value", {}, { key: "TAKI_WS_PORT", value: 0 }],
    ["secret", {}, { key: "TAKI_PROVIDER_API_KEY", value: "sk-x" }],
    ["env-only", {}, { key: "TAKI_DATA_DIR", value: "C:/x" }],
  ] as const)("refuses with reason %s and leaves the store untouched", (reason, env, input) => {
    const { repo, writer, changes } = build(env);

    const outcome = writer.set(input);
    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ reason });
    expect(repo.all().size).toBe(0);
    expect(changes).toEqual([]);
  });

  it("a wrong-typed value is refused by the knob's own schema", () => {
    const { writer } = build();
    expect(writer.set({ key: "TAKI_MAX_STEPS", value: "many" })).toMatchObject({ ok: false, reason: "invalid-value" });
    expect(writer.set({ key: "TAKI_AMBIENT_SCREENSHOT", value: "yes" })).toMatchObject({ reason: "invalid-value" });
  });

  it("works without a change listener", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    dbs.push(db);
    const writer = createConfigWriter({ env: {}, repo: createConfigRepo(db) });
    expect(writer.set({ key: "TAKI_LOG_LEVEL", value: "debug" }).ok).toBe(true);
  });

  it("an empty env var does not lock the knob", () => {
    const { writer } = build({ TAKI_MAX_STEPS: "" });
    expect(writer.set({ key: "TAKI_MAX_STEPS", value: 22 }).ok).toBe(true);
  });

  it("overrides environment configuration and reset deliberately restores it", () => {
    const env = { TAKI_MAX_STEPS: "7" };
    const { repo, writer, changes } = build(env);
    const source = createConfigSource({ env, repo });
    expect(writer.set({ key: "TAKI_MAX_STEPS", value: 22 })).toMatchObject({ ok: true, value: 22 });
    expect(source.resolve("TAKI_MAX_STEPS")).toEqual({ value: 22, origin: "stored" });
    expect(writer.set({ key: "TAKI_MAX_STEPS", value: null })).toMatchObject({ ok: true, value: null });
    expect(source.resolve("TAKI_MAX_STEPS")).toEqual({ value: 7, origin: "env" });
    expect(changes).toEqual([{ key: "TAKI_MAX_STEPS", value: 22 }, { key: "TAKI_MAX_STEPS", value: null }]);
  });

  it("refuses reset to invalid environment input without removing the working override", () => {
    const { repo, writer, changes } = build({ TAKI_MAX_STEPS: "invalid-env-value" });
    expect(writer.set({ key: "TAKI_MAX_STEPS", value: 22 }).ok).toBe(true);
    changes.length = 0;
    expect(writer.set({ key: "TAKI_MAX_STEPS", value: null })).toMatchObject({ ok: false, reason: "invalid-value" });
    expect(repo.get("TAKI_MAX_STEPS")).toBe(22);
    expect(changes).toEqual([]);
  });

  it.each(["TAKI_AMBIENT_SCREENSHOT", "TAKI_TRUST_LOOPBACK_OPERATOR"])("does not turn invalid boolean reset input into false for %s", (key) => {
    const { repo, writer, changes } = build({ [key]: "off" });
    expect(writer.set({ key, value: true }).ok).toBe(true);
    changes.length = 0;
    expect(writer.set({ key, value: null })).toMatchObject({ ok: false, reason: "invalid-value" });
    expect(repo.get(key)).toBe(true);
    expect(changes).toEqual([]);
  });

  it("validates timing reset against the actual environment fallback rather than the default", () => {
    const { repo, writer, changes } = build({ TAKI_RECONNECT_BASE_MS: "2000" });
    expect(writer.set({ key: "TAKI_RECONNECT_BASE_MS", value: 200 }).ok).toBe(true);
    expect(writer.set({ key: "TAKI_RECONNECT_CAP_MS", value: 1000 }).ok).toBe(true);
    changes.length = 0;
    expect(writer.set({ key: "TAKI_RECONNECT_BASE_MS", value: null })).toMatchObject({ ok: false, reason: "invalid-value" });
    expect(repo.get("TAKI_RECONNECT_BASE_MS")).toBe(200);
    expect(changes).toEqual([]);
  });

  it("accepts an environment reset that is valid even when the registry default would be invalid", () => {
    const { repo, writer } = build({ TAKI_RECONNECT_BASE_MS: "200" });
    expect(writer.set({ key: "TAKI_RECONNECT_BASE_MS", value: 100 }).ok).toBe(true);
    expect(writer.set({ key: "TAKI_RECONNECT_CAP_MS", value: 300 }).ok).toBe(true);
    expect(writer.set({ key: "TAKI_RECONNECT_BASE_MS", value: null })).toMatchObject({ ok: true, value: null });
    expect(repo.get("TAKI_RECONNECT_BASE_MS")).toBeNull();
  });

  it("retains aggregate initiative constraints when reset reveals an environment limit", () => {
    const { repo, writer, changes } = build({ TAKI_INITIATIVE_UTTERANCE_HOUR_LIMIT: "9" });
    expect(writer.set({ key: "TAKI_INITIATIVE_UTTERANCE_HOUR_LIMIT", value: 3 }).ok).toBe(true);
    changes.length = 0;
    expect(writer.set({ key: "TAKI_INITIATIVE_UTTERANCE_HOUR_LIMIT", value: null })).toMatchObject({ ok: false, reason: "invalid-value" });
    expect(repo.get("TAKI_INITIATIVE_UTTERANCE_HOUR_LIMIT")).toBe(3);
    expect(changes).toEqual([]);
  });

  it("refuses cross-field-invalid timing changes without mutation or push", () => {
    const { repo, writer, changes } = build();

    expect(writer.set({ key: "TAKI_RECONNECT_CAP_MS", value: 400 })).toMatchObject({
      ok: false,
      reason: "invalid-value",
    });
    expect(writer.set({ key: "TAKI_RENDERER_LOAD_TIMEOUT_MS", value: 40_000 })).toMatchObject({
      ok: false,
      reason: "invalid-value",
    });
    expect(writer.set({ key: "TAKI_HOME_RESULT_TIMEOUT_MS", value: 40_000 })).toMatchObject({
      ok: false,
      reason: "invalid-value",
    });
    expect(repo.all().size).toBe(0);
    expect(changes).toEqual([]);
  });

  it("accepts a consistent timing override and reset returns to the shared default", () => {
    const { repo, writer } = build();
    expect(writer.set({ key: "TAKI_RENDERER_LOAD_TIMEOUT_MS", value: 35_000 }).ok).toBe(true);
    expect(repo.get("TAKI_RENDERER_LOAD_TIMEOUT_MS")).toBe(35_000);
    expect(writer.set({ key: "TAKI_RENDERER_LOAD_TIMEOUT_MS", value: null }).ok).toBe(true);
    expect(repo.get("TAKI_RENDERER_LOAD_TIMEOUT_MS")).toBeNull();
  });
});
