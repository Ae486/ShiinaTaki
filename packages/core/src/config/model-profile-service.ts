/**
 * INPUT: Core profile/config repositories, Secret Catalog, and captured launch environment
 * OUTPUT: durable drafts, locally applied model bindings, explicit tests and change subscriptions
 * POS: core/config — one profile authority; provider health never gates startup or saving
 */
import { APICallError, generateText } from "ai";
import type { ModelProfileForm, ModelProfileSaveParams, ModelProfilesResult, ModelProfileStatus, ModelProfileTestParams, ModelProfileTestResult, ModelSlot } from "@taki/shared";
import type { ConfigSource } from "./config-source.ts";
import { createProfileResolution, ModelProfileError, profileFailure, type ModelBinding } from "./model-profile-resolution.ts";
import { createModelProfileRepo, type ModelProfileRow, type StoredModelProfile } from "../db/model-profile-repo.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import type { Database } from "../db/sqlite.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import { createModelProfileSecrets } from "./model-profile-secrets.ts";

export { ModelProfileError } from "./model-profile-resolution.ts";
export type { ModelBinding } from "./model-profile-resolution.ts";

interface ProfileState {
  row: ModelProfileRow;
  binding?: ModelBinding;
  active: StoredModelProfile | null;
  source: "application" | "environment";
  issues: string[];
}
export interface ModelProfileService {
  list(): ModelProfilesResult;
  save(input: ModelProfileSaveParams): ModelProfilesResult;
  test(input: ModelProfileTestParams): Promise<ModelProfileTestResult>;
  binding(slot: ModelSlot): ModelBinding | undefined;
  refresh(): void;
  legacyChanged(key: string): ModelProfilesResult;
  subscribe(listener: () => void): () => void;
}
interface ProfileServiceDeps {
  db: Database;
  source: ConfigSource;
  env: Record<string, string | undefined>;
  secrets: Pick<SecretCatalogService, "resolve" | "set" | "clear">;
}

export function createModelProfileService(deps: ProfileServiceDeps): ModelProfileService {
  const repo = createModelProfileRepo(deps.db);
  const config = createConfigRepo(deps.db);
  const resolver = createProfileResolution(deps);
  const state = createProfileState(deps, resolver);
  const { list, current, refresh, states, load, emit } = state;
  const secrets = createModelProfileSecrets(deps.db, deps.secrets);
  const reconcileSecrets = () => secrets.reconcile((["main", "utility"] as const).flatMap((slot) => {
    const row = repo.read(slot); return [row?.draft ?? null, row?.applied?.profile ?? null];
  }));
  const save = (input: ModelProfileSaveParams, mirror = true): ModelProfilesResult => {
    const old = current(input.slot, input.expectedRevision);
    const profile = input.action === "reset" ? resolver.initial(input.slot, true).row.draft
      : authoredProfile({ slot: input.slot, form: requiredForm(input.profile), old, secrets, resolve: resolver.secret });
    const next = prepareSave({ input, old, profile, main: states.get("main")?.binding, resolver });
    try {
      deps.db.transaction(() => {
        repo.save(next.row, input.expectedRevision);
        if (!mirror || next.row.applicationState !== "applied") return;
        const prefix = input.slot === "main" ? "TAKI_PROVIDER_" : "TAKI_UTILITY_";
        if (input.action === "reset") {
          config.delete(prefix + "BASE_URL"); config.delete(prefix + "MODEL");
        } else if (profile.mode === "configured") {
          config.upsert(prefix + "BASE_URL", profile.baseUrl); config.upsert(prefix + "MODEL", profile.model);
        }
      });
    } catch (cause) {
      reconcileSecrets();
      if (cause instanceof Error && cause.message === "MODEL_PROFILE_CONFLICT") throw new ModelProfileError("MODEL_PROFILE_CONFLICT");
      throw cause;
    }
    states.set(input.slot, next);
    if (input.slot === "main") states.set("utility", load("utility"));
    reconcileSecrets();
    emit();
    return list();
  };
  refresh();
  reconcileSecrets();
  return { list, save, refresh, binding: (slot) => states.get(slot)?.binding, subscribe: state.subscribe,
    legacyChanged(key) {
      const slot = key.startsWith("TAKI_UTILITY_") ? "utility" : "main";
      return save(legacyChange(deps.source, key, states.get(slot)!), false);
    },
    test: (input) => testCandidate({ input, old: current(input.slot, input.expectedRevision), resolver, main: states.get("main")?.binding }) };
}

function legacyChange(source: ConfigSource, key: string, old: ProfileState): ModelProfileSaveParams {
  const field = key.endsWith("BASE_URL") ? "baseUrl" : "model";
  const form = { ...old.row.draft, [field]: String(source.resolve(key)?.value ?? "") };
  const complete = form.mode !== "configured" || (!!form.baseUrl.trim() && !!form.model.trim()
    && (form.auth === "none" || !!matchingSecret(form, old)?.secretRef));
  return { slot: old.row.slot, expectedRevision: old.row.revision, action: complete ? "apply" : "draft", profile: form };
}

function createProfileState(deps: ProfileServiceDeps, resolver: ReturnType<typeof createProfileResolution>) {
  const repo = createModelProfileRepo(deps.db);
  const listeners = new Set<() => void>();
  const states = new Map<ModelSlot, ProfileState>();
  const load = (slot: ModelSlot): ProfileState => {
    const initial = resolver.initial(slot);
    const row = repo.read(slot) ?? initial.row;
    const source = row.applied?.source ?? initial.source;
    const active = row.applied?.source === "environment" ? resolver.initial(slot, true).row.draft
      : row.applied?.profile ?? (row.revision === 0 ? row.draft : null);
    const draft = row.applicationState === "applied" && source === "environment" && active ? active : row.draft;
    try {
      return { row: { ...row, draft }, active, source, issues: row.issues,
        binding: active ? resolver.prepare({ slot, profile: active, source, revision: row.applied?.revision ?? 0,
          main: states.get("main")?.binding, allowEmpty: source === "environment" }) : undefined };
    } catch (cause) { return { row, active, source, issues: [profileFailure(cause)] }; }
  };
  const emit = () => {
    for (const listener of listeners) {
      try { listener(); } catch { /* Committed configuration does not depend on observers. */ }
    }
  };
  const refresh = () => {
    states.set("main", load("main"));
    states.set("utility", load("utility"));
    emit();
  };
  const list = (): ModelProfilesResult => ({ profiles: (["main", "utility"] as const)
    .map((slot) => projectStatus(slot, states.get(slot)!, resolver.project)) });
  const current = (slot: ModelSlot, revision: number): ProfileState => {
    const value = states.get(slot);
    if (!value || value.row.revision !== revision) throw new ModelProfileError("MODEL_PROFILE_CONFLICT");
    return value;
  };
  return { states, load, emit, list, current, refresh,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}

async function testCandidate(candidate: {
  input: ModelProfileTestParams; old: ProfileState; resolver: ReturnType<typeof createProfileResolution>; main?: ModelBinding;
}): Promise<ModelProfileTestResult> {
      const { input, old, resolver, main } = candidate;
      try {
        const profile = input.profile ? testProfile(input.profile, old) : old.row.draft;
        const binding = resolver.prepare({ slot: input.slot, profile, revision: old.row.revision, source: "application",
          main, apiKey: input.profile?.apiKey });
        if (!binding) throw new ModelProfileError("MODEL_UNAVAILABLE");
        await generateText({ model: binding.model, prompt: "Reply OK.", maxOutputTokens: 16, maxRetries: 0, abortSignal: AbortSignal.timeout(15_000) });
        return { ok: true, code: "MODEL_TEST_OK", message: "连接测试成功。" };
      } catch (cause) {
        const code = APICallError.isInstance(cause) ? `PROVIDER_HTTP_${cause.statusCode ?? "UNKNOWN"}` : profileFailure(cause);
        return { ok: false, code, message: "连接测试未成功，请检查服务地址、模型和认证配置。" };
      }
}

function prepareSave(input: {
  input: ModelProfileSaveParams; old: ProfileState; profile: StoredModelProfile; main?: ModelBinding;
  resolver: ReturnType<typeof createProfileResolution>;
}): ProfileState {
  const { old, profile, resolver } = input;
  const revision = old.row.revision + 1;
  const source = input.input.action === "reset" ? "environment" : "application";
  let binding = old.binding; let active = old.active;
  let applied = old.row.applied ?? (old.active && old.row.revision === 0
    ? { revision: 0, profile: old.active, source: old.source } : null);
  let applicationState: ModelProfileRow["applicationState"] = "draft";
  let issues: string[] = [];
  if (input.input.action !== "draft") {
    try {
      binding = resolver.prepare({ slot: input.input.slot, profile, revision, source, main: input.main, allowEmpty: source === "environment" });
      active = profile; applied = { revision, profile, source }; applicationState = "applied";
    } catch (cause) { issues = [profileFailure(cause)]; applicationState = "failed"; }
  }
  return { row: { slot: input.input.slot, revision, draft: profile, applied, applicationState, issues },
    active, binding, source: applicationState === "applied" ? source : old.source, issues };
}

function matchingSecret(form: ModelProfileForm, old: ProfileState): StoredModelProfile | null {
  if (old.row.draft.baseUrl === form.baseUrl && old.row.draft.auth === "api-key" && old.row.draft.secretRef) return old.row.draft;
  return old.active?.baseUrl === form.baseUrl && old.active.auth === "api-key" ? old.active : null;
}
function authoredProfile(input: {
  slot: ModelSlot; form: ModelProfileForm; old: ProfileState; secrets: ReturnType<typeof createModelProfileSecrets>;
  resolve: (profile: StoredModelProfile) => string | undefined;
}): StoredModelProfile {
  const { apiKey, mode, baseUrl, model, auth } = input.form;
  const profile = { mode, baseUrl, model, auth };
  if (profile.auth === "none" || profile.mode !== "configured") return profile;
  const previous = matchingSecret(input.form, input.old);
  const value = apiKey ?? (previous ? input.resolve(previous) : undefined);
  if (!value) return profile;
  if (previous?.secretRef && !previous.secretRef.startsWith("environment:") && value === input.resolve(previous)) {
    return { ...profile, secretRef: previous.secretRef };
  }
  const secretRef = input.secrets.stage(input.slot, value);
  return { ...profile, secretRef };
}
function testProfile(form: ModelProfileForm, old: ProfileState): StoredModelProfile {
  return { mode: form.mode, baseUrl: form.baseUrl, model: form.model, auth: form.auth,
    secretRef: form.auth === "api-key" ? matchingSecret(form, old)?.secretRef : undefined };
}
function requiredForm(value: ModelProfileForm | undefined): ModelProfileForm {
  if (!value) throw new ModelProfileError("MODEL_PROFILE_REQUIRED");
  return value;
}
function projectStatus(slot: ModelSlot, state: ProfileState, project: ReturnType<typeof createProfileResolution>["project"]): ModelProfileStatus {
  const { row, binding } = state;
  return { slot, revision: row.revision, draft: project(row.draft),
    active: binding && state.active ? { ...project(state.active), baseUrl: binding.baseUrl, model: binding.modelId,
      auth: binding.auth, secretSet: binding.auth === "api-key", revision: binding.revision, source: binding.source } : null,
    state: binding ? "ready" : state.active?.mode === "disabled" ? "disabled" : state.issues.length ? "invalid" : "unconfigured",
    applicationState: row.applicationState, issues: state.issues };
}
