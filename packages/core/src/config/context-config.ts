/**
 * INPUT:  process env (TAKI_PROVIDER_CONTEXT_TOKENS / TAKI_VLM_CONTEXT_TOKENS / TAKI_UTILITY_CONTEXT_TOKENS /
 *         TAKI_CONTEXT_HISTORY_RATIO / TAKI_PROVIDER_INCLUDE_USAGE) — the token-window knobs (T5-R1 tier 1 + Q14)
 * OUTPUT: loadContextConfig(env) -> { contextTokens: {main, vision, utility}, historyRatio, includeUsage };
 *         fail-closed defaults
 * POS:    core/config — the token-window knobs (T5-R13); garbage values are fatal at boot, never silently
 *         defaulted. Panel surfaces are #26's
 */
import { z } from "zod";

// LOCAL choice, no external source: a conservative floor for DeepSeek-class gateways. A too-low declaration costs
// window headroom; a too-high one costs exactly one R2-self-healed request — so the default errs low.
export const DEFAULT_CONTEXT_TOKENS = 32768;

// LOCAL choice: the slice of the effective window granted to replayed history; the remainder covers instructions +
// tool schemas + the response. One knob on purpose — per-component reserves would be speculative config (KISS).
export const DEFAULT_HISTORY_RATIO = 0.55;

// Coerce + int + positive: "abc"/"0"/"-1"/"3.5" all throw at boot (the memory-config budget discipline — a garbage
// window must never silently shrink her history or blow the provider limit).
const windowKnob = () => z.coerce.number().int().positive().default(DEFAULT_CONTEXT_TOKENS);

// Strict true/1/false/0 (case-insensitive; empty = unset), anything else fatal — the ambient-screenshot kill-switch
// parse discipline (2nd instance of that local parser; extraction waits for the 3rd).
function parseBooleanFlag(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return undefined;
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return value; // z.boolean() rejects it -> the boot throws, naming the var
}

// Env-var names ARE the schema keys so a fatal boot error names the variable the operator mistyped.
export const ContextConfigSchema = z
  .object({
    TAKI_PROVIDER_CONTEXT_TOKENS: windowKnob(),
    TAKI_VLM_CONTEXT_TOKENS: windowKnob(),
    TAKI_UTILITY_CONTEXT_TOKENS: windowKnob(),
    // 0 < ratio <= 1: a zero ratio would replay no history at all, above 1 would grant history more than the window.
    TAKI_CONTEXT_HISTORY_RATIO: z.coerce.number().positive().max(1).default(DEFAULT_HISTORY_RATIO),
    // Q14: opt-in streaming usage (`stream_options:{include_usage:true}` on the wire). DEFAULT OFF — gateway
    // compatibility is unverified (T5-R1's verified fact), and the estimator must never depend on usage arriving.
    TAKI_PROVIDER_INCLUDE_USAGE: z.preprocess(parseBooleanFlag, z.boolean().default(false)),
  })
  .transform((env) => ({
    contextTokens: {
      main: env.TAKI_PROVIDER_CONTEXT_TOKENS,
      vision: env.TAKI_VLM_CONTEXT_TOKENS,
      utility: env.TAKI_UTILITY_CONTEXT_TOKENS,
    },
    historyRatio: env.TAKI_CONTEXT_HISTORY_RATIO,
    includeUsage: env.TAKI_PROVIDER_INCLUDE_USAGE,
  }));

export type ContextConfig = z.infer<typeof ContextConfigSchema>;

export function loadContextConfig(env: Record<string, string | undefined>): ContextConfig {
  return ContextConfigSchema.parse({
    TAKI_PROVIDER_CONTEXT_TOKENS: env.TAKI_PROVIDER_CONTEXT_TOKENS,
    TAKI_VLM_CONTEXT_TOKENS: env.TAKI_VLM_CONTEXT_TOKENS,
    TAKI_UTILITY_CONTEXT_TOKENS: env.TAKI_UTILITY_CONTEXT_TOKENS,
    TAKI_CONTEXT_HISTORY_RATIO: env.TAKI_CONTEXT_HISTORY_RATIO,
    TAKI_PROVIDER_INCLUDE_USAGE: env.TAKI_PROVIDER_INCLUDE_USAGE,
  });
}
