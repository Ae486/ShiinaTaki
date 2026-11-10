import { afterEach, describe, expect, it } from "vitest";
import { createConfigRepo } from "../db/config-repo.ts";
import { createWindowStateRepo } from "../db/window-state-repo.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createAgentRuntimeConfig } from "./agent-runtime-config.ts";
import { createModelProfileService } from "./model-profile-service.ts";
import { createConfigSource } from "./config-source.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture(env: Record<string, string> = {}) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const repo = createConfigRepo(db); const source = createConfigSource({ repo, env });
  const models = createModelProfileService({ db, source, env, secrets: {
    resolve: () => null, set: () => { throw new Error("unexpected secret write"); }, clear: () => ({ present: false }) } });
  const profile = { mode: "configured" as const, baseUrl: "http://127.0.0.1:1/v1", model: "a", auth: "none" as const };
  models.save({ slot: "main", expectedRevision: 0, action: "apply", profile });
  const windows = createWindowStateRepo(db);
  return { repo, models, profile, windows, runtime: createAgentRuntimeConfig({ models, source, windows }) };
}

describe("admitted model policy", () => {
  it("retains old limits and replay calibration while new bindings use applied policy", () => {
    const h = fixture(); const old = h.runtime.capture()!;
    h.repo.upsert("TAKI_MAX_STEPS", 4); h.repo.upsert("TAKI_PROVIDER_CONTEXT_TOKENS", 64000);
    h.models.save({ slot: "main", expectedRevision: 1, action: "apply", profile: { ...h.profile, model: "b" } });
    h.runtime.refresh(); const fresh = h.runtime.capture()!;
    old.onOverflow(10000);
    expect(old.modelId).toBe("a"); expect(old.maxSteps).toBe(10);
    expect(old.historyBudget()).toBe(6300);
    expect(fresh.modelId).toBe("b"); expect(fresh.maxSteps).toBe(4);
    expect(fresh.requestWindowSnapshot().effectiveRealTokens).toBe(64000);
    expect(h.windows.list()).toHaveLength(1);
  });

  it("does not let a retired same-model credential revision calibrate its replacement", () => {
    const h = fixture(); const old = h.runtime.capture()!;
    h.models.save({ slot: "main", expectedRevision: 1, action: "apply", profile: h.profile });
    h.runtime.refresh(); const fresh = h.runtime.capture()!;
    old.onOverflow(10000);
    expect(fresh.requestWindowSnapshot().effectiveRealTokens).toBe(131072);
  });

  it("isolates invalid Utility context and exposes invalid Main policy without crashing construction", () => {
    const h = fixture({ TAKI_UTILITY_CONTEXT_TOKENS: "invalid" });
    expect(h.runtime.capture()).toBeDefined();
    const broken = fixture({ TAKI_MAX_STEPS: "invalid" });
    expect(broken.runtime.available()).toBe(false);
    expect(broken.runtime.issue()).toBe("MODEL_POLICY_INVALID");
    expect(() => broken.runtime.capture()).toThrow();
    broken.repo.upsert("TAKI_MAX_STEPS", 3); broken.runtime.refresh();
    expect(broken.runtime.capture()?.maxSteps).toBe(3);
  });
});
