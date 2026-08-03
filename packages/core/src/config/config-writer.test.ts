import { afterEach, describe, expect, it } from "vitest";
import type { ConfigChanged } from "@taki/shared";
import { createConfigRepo, type ConfigRepo } from "../db/config-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createConfigWriter, type ConfigWriter } from "./config-writer.ts";

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
      apply: "restart",
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
    ["env-locked", { TAKI_MAX_STEPS: "7" }, { key: "TAKI_MAX_STEPS", value: 22 }],
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
});
