import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelProfilesResultSchema, type ModelProfileForm } from "@taki/shared";
import { createConfigRepo } from "../db/config-repo.ts";
import { createModelProfileRepo } from "../db/model-profile-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { SecretRefusalError } from "../secrets/secret-catalog-service.ts";
import { createModelProfileSecrets } from "./model-profile-secrets.ts";
import { createConfigSource } from "./config-source.ts";
import { createModelProfileService } from "./model-profile-service.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const PROFILE: ModelProfileForm = { mode: "configured", baseUrl: "http://127.0.0.1:1/v1", model: "main-a", auth: "none" };

function harness(env: Record<string, string | undefined> = {}) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const config = createConfigRepo(db);
  const values = new Map<string, string>();
  const secrets = { resolve: (ref: string) => values.get(ref) ?? null,
    set: vi.fn((ref: string, value: string) => {
      values.set(ref, value);
      return { present: true as const, provenance: { source: "catalog" as const, keyVersion: 1, updatedAt: new Date().toISOString() } };
    }),
    clear: (ref: string) => { values.delete(ref); return { present: false as const }; },
  };
  const create = () => createModelProfileService({ db, source: createConfigSource({ env, repo: config }), env, secrets });
  return { db, config, values, secrets, create, service: create() };
}

describe("model profile application", () => {
  it("opens with empty Main and inherited Utility without requiring a provider or credential", () => {
    const h = harness();
    expect(ModelProfilesResultSchema.safeParse(h.service.list()).success).toBe(true);
    expect(h.service.list().profiles.map((p) => p.state)).toEqual(["unconfigured", "unconfigured"]);
    expect(h.service.binding("main")).toBeUndefined();
    expect(h.secrets.set).not.toHaveBeenCalled();
  });

  it("preserves an incomplete draft across reopening and activates a keyless complete candidate locally", () => {
    const h = harness();
    h.service.save({ slot: "main", expectedRevision: 0, action: "draft", profile: { ...PROFILE, model: "" } });
    const reopened = h.create();
    expect(reopened.list().profiles[0]).toMatchObject({ revision: 1, applicationState: "draft", active: null, draft: { model: "" } });
    reopened.save({ slot: "main", expectedRevision: 1, action: "apply", profile: PROFILE });
    expect(reopened.binding("main")).toMatchObject({ modelId: "main-a", revision: 2 });
    expect(reopened.binding("utility")).toMatchObject({ modelId: "main-a", source: "inherited" });
    expect(h.secrets.set).not.toHaveBeenCalled();
  });

  it("retains a working active binding through failed apply, draft save and reopening", () => {
    const h = harness();
    h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: PROFILE });
    const captured = h.service.binding("main");
    h.service.save({ slot: "main", expectedRevision: 1, action: "apply", profile: { ...PROFILE, baseUrl: "malformed" } });
    expect(h.service.binding("main")).toBe(captured);
    expect(h.create().list().profiles[0]).toMatchObject({ state: "ready", applicationState: "failed", active: { model: "main-a" }, issues: ["MODEL_URL_INVALID"] });
    h.service.save({ slot: "main", expectedRevision: 2, action: "draft", profile: { ...PROFILE, model: "" } });
    expect(h.create().binding("main")).toMatchObject({ modelId: "main-a" });
  });

  it("blocks competing edits before staging secrets or changing active configuration", () => {
    const h = harness();
    h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: PROFILE });
    expect(() => h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: { ...PROFILE, auth: "api-key", apiKey: "private" } }))
      .toThrow("MODEL_PROFILE_CONFLICT");
    expect(h.secrets.set).not.toHaveBeenCalled();
  });

  it("adopts stored model fields first and does not borrow another endpoint's environment credential", () => {
    const h = harness({ TAKI_PROVIDER_BASE_URL: "https://old.invalid/v1", TAKI_PROVIDER_MODEL: "old", TAKI_PROVIDER_API_KEY: "private" });
    h.config.upsert("TAKI_PROVIDER_BASE_URL", PROFILE.baseUrl); h.config.upsert("TAKI_PROVIDER_MODEL", PROFILE.model);
    const adopted = h.create();
    expect(adopted.list().profiles[0]).toMatchObject({ state: "invalid", draft: { baseUrl: PROFILE.baseUrl, model: "main-a", secretSet: false }, issues: ["MODEL_CREDENTIAL_UNAVAILABLE"] });
    adopted.save({ slot: "main", expectedRevision: 0, action: "apply", profile: PROFILE });
    expect(adopted.binding("main")).toMatchObject({ modelId: "main-a", source: "application" });
  });

  it("keeps disable and no-auth distinct from reset, including after environment changes and reopen", () => {
    const env = { TAKI_PROVIDER_BASE_URL: PROFILE.baseUrl, TAKI_PROVIDER_MODEL: "env-a", TAKI_PROVIDER_API_KEY: "environment-secret" };
    const h = harness(env);
    h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: { ...PROFILE, mode: "disabled" } });
    expect(h.create().list().profiles[0]?.state).toBe("disabled");
    h.service.save({ slot: "main", expectedRevision: 1, action: "apply", profile: PROFILE });
    expect(h.create().list().profiles[0]?.active).toMatchObject({ auth: "none", secretSet: false });
    h.service.save({ slot: "main", expectedRevision: 2, action: "reset" });
    expect(h.service.binding("main")).toMatchObject({ modelId: "env-a", source: "environment" });
    env.TAKI_PROVIDER_MODEL = "env-b";
    expect(h.create().binding("main")).toMatchObject({ modelId: "env-b", source: "environment" });
    expect(h.config.get("TAKI_PROVIDER_MODEL")).toBeNull();
  });

  it("reset to an empty fallback removes application ownership instead of retaining the old model", () => {
    const h = harness();
    h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: PROFILE });
    h.service.save({ slot: "main", expectedRevision: 1, action: "reset" });
    expect(h.service.list().profiles[0]).toMatchObject({ active: null, state: "unconfigured", applicationState: "applied" });
    expect(h.create().binding("main")).toBeUndefined();
  });

  it("explicit Utility is independent and an invalid draft never silently falls back to Main", () => {
    const h = harness();
    h.service.save({ slot: "utility", expectedRevision: 0, action: "apply", profile: { ...PROFILE, model: "utility-a" } });
    expect(h.service.binding("main")).toBeUndefined();
    expect(h.service.binding("utility")?.modelId).toBe("utility-a");
    h.service.save({ slot: "utility", expectedRevision: 1, action: "apply", profile: { ...PROFILE, mode: "disabled" } });
    h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: PROFILE });
    expect(h.service.binding("utility")).toBeUndefined();
  });

  it("retains captured credentials, omits them from SQLite/projections, and reuses unchanged secret references", () => {
    const h = harness();
    h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: { ...PROFILE, auth: "api-key", apiKey: "private-a" } });
    const before = h.service.binding("main");
    h.service.save({ slot: "main", expectedRevision: 1, action: "apply", profile: { ...PROFILE, auth: "api-key", model: "main-b" } });
    expect(h.secrets.set).toHaveBeenCalledTimes(1);
    h.service.save({ slot: "main", expectedRevision: 2, action: "apply", profile: { ...PROFILE, auth: "api-key", apiKey: "private-b" } });
    expect(before?.modelId).toBe("main-a");
    expect(JSON.stringify(createModelProfileRepo(h.db).read("main"))).not.toContain("private-");
    expect(JSON.stringify(h.service.list())).not.toContain("private-");
    expect(h.values.size).toBe(1);
  });

  it("preserves prior state when secret storage refuses publication", () => {
    const h = harness();
    h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: PROFILE });
    const before = h.service.list();
    h.secrets.set.mockImplementation(() => { throw new SecretRefusalError("store-locked"); });
    expect(() => h.service.save({ slot: "main", expectedRevision: 1, action: "apply", profile: { ...PROFILE, auth: "api-key", apiKey: "private" } })).toThrow(SecretRefusalError);
    expect(h.service.list()).toEqual(before);
  });

  it("rejects an invalid unsaved test locally without changing either draft or active state", async () => {
    const h = harness(); const before = h.service.list();
    expect(await h.service.test({ slot: "main", expectedRevision: 0,
      profile: { ...PROFILE, baseUrl: "file:///private", auth: "api-key", apiKey: "private" } }))
      .toMatchObject({ ok: false, code: "MODEL_URL_INVALID" });
    expect(h.service.list()).toEqual(before); expect(h.secrets.set).not.toHaveBeenCalled();
  });

  it("reconciles staged orphan secrets after reopening and preserves unrelated catalog ownership", () => {
    const h = harness();
    h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: { ...PROFILE, auth: "api-key", apiKey: "active" } });
    const owned = createModelProfileSecrets(h.db, h.secrets);
    owned.stage("main", "orphaned-before-sqlite-publication");
    h.values.set("model.main.unrelated-user-owned", "unrelated");
    expect(h.values.size).toBe(3);
    const reopened = h.create();
    expect(reopened.binding("main")?.modelId).toBe("main-a");
    expect([...h.values.values()].sort()).toEqual(["active", "unrelated"]);
  });

  it("does not delete the winning revision's credentials when a stale service loses a compare-and-swap", () => {
    const h = harness();
    const stale = h.create();
    h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: { ...PROFILE, auth: "api-key", apiKey: "winner" } });
    expect(() => stale.save({ slot: "main", expectedRevision: 0, action: "apply",
      profile: { ...PROFILE, auth: "api-key", apiKey: "loser" } })).toThrow("MODEL_PROFILE_CONFLICT");
    expect([...h.values.values()]).toEqual(["winner"]);
    expect(h.create().list().profiles[0]?.active?.secretSet).toBe(true);
  });

  it("bridges scalar edits and resets while retaining mode and forbidding cross-endpoint credentials", () => {
    const h = harness({ TAKI_PROVIDER_MODEL: "fallback-model" });
    h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: { ...PROFILE, auth: "api-key", apiKey: "private" } });
    h.config.upsert("TAKI_PROVIDER_MODEL", "scalar-model");
    h.service.legacyChanged("TAKI_PROVIDER_MODEL");
    expect(h.service.binding("main")?.modelId).toBe("scalar-model");
    h.config.delete("TAKI_PROVIDER_MODEL"); h.service.legacyChanged("TAKI_PROVIDER_MODEL");
    expect(h.service.binding("main")?.modelId).toBe("fallback-model");
    expect(h.config.get("TAKI_PROVIDER_MODEL")).toBeNull();
    h.config.upsert("TAKI_PROVIDER_BASE_URL", "https://other.invalid/v1");
    h.service.legacyChanged("TAKI_PROVIDER_BASE_URL");
    expect(h.service.list().profiles[0]).toMatchObject({ applicationState: "draft", draft: { secretSet: false }, active: { baseUrl: PROFILE.baseUrl } });
  });

  it("projects inherited authentication from the active Main binding", () => {
    const h = harness();
    h.service.save({ slot: "main", expectedRevision: 0, action: "apply", profile: { ...PROFILE, auth: "api-key", apiKey: "private" } });
    expect(h.service.list().profiles[1]?.active).toMatchObject({ mode: "inherit", auth: "api-key", secretSet: true });
  });
});
