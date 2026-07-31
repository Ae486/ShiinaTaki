/**
 * INPUT:  process env (TAKI_UTILITY_BASE_URL / _API_KEY / _MODEL) — the UTILITY model slot for background work
 * OUTPUT: loadUtilityConfig(env) -> { baseUrl, apiKey, model } | null (slot absent); partial = fatal, names the missing var
 * POS:    core/config — the third optional model slot (vision-config precedent); absent means background work runs on
 *         the MAIN model (T5-R11 fallback), so "off" degrades rather than disabling a feature; apiKey never logged
 */
import { z } from "zod";

// Env-var names ARE the schema keys so a fatal boot error names the exact missing variable (vision-config precedent).
export const UtilityConfigSchema = z
  .object({
    TAKI_UTILITY_BASE_URL: z.string().min(1),
    TAKI_UTILITY_API_KEY: z.string().min(1),
    TAKI_UTILITY_MODEL: z.string().min(1),
  })
  .transform((env) => ({
    baseUrl: env.TAKI_UTILITY_BASE_URL,
    apiKey: env.TAKI_UTILITY_API_KEY,
    model: env.TAKI_UTILITY_MODEL,
  }));

export type UtilityConfig = z.infer<typeof UtilityConfigSchema>;

const UTILITY_KEYS = ["TAKI_UTILITY_BASE_URL", "TAKI_UTILITY_API_KEY", "TAKI_UTILITY_MODEL"] as const;

// All-or-nothing: none set = no separate slot (null -> the utility slot falls back to the main model); a partial set is
// fatal-fast naming the missing var, because a half-configured background provider must not silently spend on the
// chat model the operator was trying to move work OFF of.
export function loadUtilityConfig(env: Record<string, string | undefined>): UtilityConfig | null {
  const present = UTILITY_KEYS.filter((key) => (env[key] ?? "").length > 0);
  if (present.length === 0) return null;
  return UtilityConfigSchema.parse(env);
}
