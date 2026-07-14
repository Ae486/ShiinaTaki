/**
 * INPUT:  process env (TAKI_VLM_BASE_URL / _API_KEY / _MODEL) — the VISION model slot, parallel to the text slot
 * OUTPUT: loadVisionConfig(env) -> { baseUrl, apiKey, model } | null (feature off); partial = fatal, names the missing var
 * POS:    core/config — the optional vision slot (may hold identical values to provider-config's text slot); apiKey never logged
 */
import { z } from "zod";

// Env-var names ARE the schema keys so a fatal boot error names the exact missing variable (provider-config precedent).
export const VisionConfigSchema = z
  .object({
    TAKI_VLM_BASE_URL: z.string().min(1),
    TAKI_VLM_API_KEY: z.string().min(1),
    TAKI_VLM_MODEL: z.string().min(1),
  })
  .transform((env) => ({
    baseUrl: env.TAKI_VLM_BASE_URL,
    apiKey: env.TAKI_VLM_API_KEY,
    model: env.TAKI_VLM_MODEL,
  }));

export type VisionConfig = z.infer<typeof VisionConfigSchema>;

const VLM_KEYS = ["TAKI_VLM_BASE_URL", "TAKI_VLM_API_KEY", "TAKI_VLM_MODEL"] as const;

// All-or-nothing (unlike the required text slot): none set = feature off (null); a partial set is fatal-fast, naming the
// missing var — the same fail-closed posture as the P3 trust flag. A configured-but-empty value is treated as absent.
export function loadVisionConfig(env: Record<string, string | undefined>): VisionConfig | null {
  const present = VLM_KEYS.filter((key) => (env[key] ?? "").length > 0);
  if (present.length === 0) return null;
  return VisionConfigSchema.parse(env);
}
