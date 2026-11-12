/**
 * INPUT: sparse legacy settings, launch environment and the owning Secret Catalog
 * OUTPUT: coherent fallback candidates, private model preparation and secret-free projection
 * POS: core/config — pure profile resolution; publication belongs to the profile service
 */
import type { LanguageModel } from "ai";
import type { ModelSlot } from "@taki/shared";
import type { ConfigSource } from "./config-source.ts";
import { createModels } from "./provider-factory.ts";
import type { ModelProfileRow, StoredModelProfile } from "../db/model-profile-repo.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";

export interface ModelBinding {
  readonly model: LanguageModel;
  readonly modelId: string;
  readonly provider: string;
  readonly revision: number;
  readonly baseUrl: string;
  readonly source: "application" | "environment" | "inherited";
  readonly auth: "none" | "api-key";
}
export class ModelProfileError extends Error {
  constructor(code: string) { super(code); this.name = "ModelProfileError"; }
}
export interface ProfileResolutionDeps {
  source: ConfigSource;
  env: Record<string, string | undefined>;
  secrets: Pick<SecretCatalogService, "resolve">;
}

export function createProfileResolution(deps: ProfileResolutionDeps) {
  const secret = (profile: StoredModelProfile): string | undefined => {
    if (profile.auth === "none") return undefined;
    if (profile.secretRef === "environment:main") return deps.env.TAKI_PROVIDER_API_KEY;
    if (profile.secretRef === "environment:utility") return deps.env.TAKI_UTILITY_API_KEY;
    return profile.secretRef ? deps.secrets.resolve(profile.secretRef) ?? undefined : undefined;
  };
  return { secret,
    initial: (slot: ModelSlot, environmentOnly = false) => initialProfile(deps, slot, environmentOnly),
    prepare(input: { slot: ModelSlot; profile: StoredModelProfile; revision: number; source: ModelBinding["source"];
      main?: ModelBinding; allowEmpty?: boolean; apiKey?: string }): ModelBinding | undefined {
      const { profile, slot, revision, source } = input;
      if (profile.mode === "disabled") return undefined;
      if (profile.mode === "inherit") {
        if (slot !== "utility") throw new ModelProfileError("MAIN_CANNOT_INHERIT");
        return input.main ? { ...input.main, source: "inherited" } : undefined;
      }
      if (input.allowEmpty && !profile.baseUrl.trim() && !profile.model.trim()) return undefined;
      if (!profile.baseUrl.trim() || !profile.model.trim()) throw new ModelProfileError("MODEL_PROFILE_INCOMPLETE");
      let endpoint: URL;
      try { endpoint = new URL(profile.baseUrl); } catch { throw new ModelProfileError("MODEL_URL_INVALID"); }
      if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new ModelProfileError("MODEL_URL_INVALID");
      const apiKey = profile.auth === "api-key" ? input.apiKey ?? secret(profile) : undefined;
      if (profile.auth === "api-key" && !apiKey) throw new ModelProfileError("MODEL_CREDENTIAL_UNAVAILABLE");
      const { model } = createModels({ provider: { baseUrl: profile.baseUrl, model: profile.model, apiKey },
        includeUsage: deps.source.resolve("TAKI_PROVIDER_INCLUDE_USAGE")?.value === true });
      return Object.freeze({ model, modelId: profile.model, provider: typeof model === "string" ? "openai-compatible" : model.provider, baseUrl: profile.baseUrl,
        auth: profile.auth, revision, source });
    },
    project: (profile: StoredModelProfile) => ({ mode: profile.mode, baseUrl: profile.baseUrl, model: profile.model,
      auth: profile.auth, secretSet: !!secret(profile) }),
  };
}

function initialProfile(deps: ProfileResolutionDeps, slot: ModelSlot, environmentOnly: boolean) {
  const prefix = slot === "main" ? "TAKI_PROVIDER_" : "TAKI_UTILITY_";
  const value = (suffix: string) => environmentOnly ? deps.env[`${prefix}${suffix}`] ?? ""
    : String(deps.source.resolve(`${prefix}${suffix}`)?.value ?? "");
  const baseUrl = value("BASE_URL"); const model = value("MODEL");
  const key = deps.env[`${prefix}API_KEY`];
  const keyMatches = !!key && deps.env[`${prefix}BASE_URL`] === baseUrl;
  const source = !environmentOnly && ["BASE_URL", "MODEL"].some((suffix) => deps.source.resolve(`${prefix}${suffix}`)?.origin === "stored")
    ? "application" as const : "environment" as const;
  const draft: StoredModelProfile = { mode: slot === "utility" && !baseUrl && !model && !key ? "inherit" : "configured",
    baseUrl, model, auth: key ? "api-key" : "none", ...(keyMatches ? { secretRef: `environment:${slot}` } : {}) };
  const row: ModelProfileRow = { slot, revision: 0, draft, applied: null, applicationState: "applied", issues: [] };
  return { row, source };
}

export function profileFailure(cause: unknown): string {
  return cause instanceof ModelProfileError ? cause.message : "MODEL_PROFILE_PREPARATION_FAILED";
}
