/**
 * INPUT:  process env (TAKI_PROVIDER_BASE_URL / _API_KEY / _MODEL)
 * OUTPUT: loadProviderConfig(env) -> { baseUrl, apiKey, model }; fatal-fast, names the missing var
 * POS:    core/config — boot-time provider credentials; apiKey never logged (invariant 5)
 */
import { z } from "zod";

// Schema keys are the env-var names so a fatal boot error names the exact missing variable.
export const ProviderConfigSchema = z
  .object({
    TAKI_PROVIDER_BASE_URL: z.string().min(1),
    TAKI_PROVIDER_API_KEY: z.string().min(1),
    TAKI_PROVIDER_MODEL: z.string().min(1),
  })
  .transform((env) => ({
    baseUrl: env.TAKI_PROVIDER_BASE_URL,
    apiKey: env.TAKI_PROVIDER_API_KEY,
    model: env.TAKI_PROVIDER_MODEL,
  }));

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export function loadProviderConfig(env: Record<string, string | undefined>): ProviderConfig {
  return ProviderConfigSchema.parse(env);
}
