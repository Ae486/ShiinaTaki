/**
 * INPUT:  effective ConfigSource environment for the dedicated Hindsight policy curator
 * OUTPUT: validated whole-pass timeout and optional additional policy instructions
 * POS:    core/config — model selection, report cap and step cap remain existing Utility/Memory settings
 */
import { z } from "zod";

export const DEFAULT_HINDSIGHT_POLICY_TIMEOUT_MS = 60_000;
export const DEFAULT_HINDSIGHT_POLICY_PROMPT = "";
export const HindsightPolicyConfigSchema = z.object({
  TAKI_HINDSIGHT_POLICY_TIMEOUT_MS: z.coerce.number().int().min(1).max(2_147_483_647).default(DEFAULT_HINDSIGHT_POLICY_TIMEOUT_MS),
  TAKI_HINDSIGHT_POLICY_PROMPT: z.string().default(DEFAULT_HINDSIGHT_POLICY_PROMPT),
}).transform((value) => ({ timeoutMs: value.TAKI_HINDSIGHT_POLICY_TIMEOUT_MS, prompt: value.TAKI_HINDSIGHT_POLICY_PROMPT }));
export type HindsightPolicyConfig = z.infer<typeof HindsightPolicyConfigSchema>;
export function loadHindsightPolicyConfig(env: Record<string, string | undefined>): HindsightPolicyConfig {
  return HindsightPolicyConfigSchema.parse({
    TAKI_HINDSIGHT_POLICY_TIMEOUT_MS: env.TAKI_HINDSIGHT_POLICY_TIMEOUT_MS || undefined,
    TAKI_HINDSIGHT_POLICY_PROMPT: env.TAKI_HINDSIGHT_POLICY_PROMPT,
  });
}
