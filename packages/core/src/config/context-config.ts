/**
 * INPUT:  process env (TAKI_PROVIDER_CONTEXT_TOKENS / TAKI_VLM_CONTEXT_TOKENS / TAKI_UTILITY_CONTEXT_TOKENS /
 *         TAKI_CONTEXT_HISTORY_RATIO / TAKI_PROVIDER_INCLUDE_USAGE / TAKI_COMPACT_TRIGGER_RATIO /
 *         TAKI_COMPACT_KEEP_MESSAGES) — the token-window + compaction knobs (T5-R1 tier 1 + Q14 + R5)
 * OUTPUT: loadContextConfig(env) -> { contextTokens: {main, vision, utility}, historyRatio, includeUsage,
 *         compact: {triggerRatio, keepMessages} }; fail-closed defaults
 * POS:    core/config — the token-window knobs (T5-R13); garbage values are fatal at boot, never silently
 *         defaulted. Panel surfaces are #26's
 */
import { z } from "zod";

// LOCAL choice, no external source (batch-7 rider, owner directive 2026-08-01: budgets are OPTIMISTIC — declaring
// too HIGH costs exactly one R2-self-healed request; too LOW silently wastes capacity forever, so the default
// moved 32768 -> 131072).
export const DEFAULT_CONTEXT_TOKENS = 131072;

// LOCAL choice: the slice of the effective window granted to replayed history; it sizes Replay View admission only.
// Proactive compaction uses the complete projected request and TAKI_COMPACT_TRIGGER_RATIO independently.
// Raised 0.55 -> 0.7 with the batch-7 optimistic-budget rider (same owner directive as above).
export const DEFAULT_HISTORY_RATIO = 0.7;

// T5-R5's ruled number: pre-compact in the background at ~80% of the effective context window. This divides the
// calibrated window directly; it is not multiplied by historyRatio.
export const DEFAULT_COMPACT_TRIGGER_RATIO = 0.8;

// Compatibility guard only: token-priced compaction retains the DSH-grounded 0.16 history-wall tail; this value keeps
// at least this many recent rows (and one older candidate for boundary discovery) when estimates are unusually cheap.
export const DEFAULT_COMPACT_KEEP_MESSAGES = 40;

// Coerce + int + positive: "abc"/"0"/"-1"/"3.5" all throw at boot (the memory-config budget discipline — a garbage
// window must never silently shrink her history or blow the provider limit).
const windowKnob = () => z.coerce.number().int().positive().default(DEFAULT_CONTEXT_TOKENS);

// 0 < ratio <= 1 (shared by the history slice and the compaction trigger): a zero would disable the surface
// entirely, above 1 would promise more than the window holds.
const ratioKnob = (fallback: number) => z.coerce.number().positive().max(1).default(fallback);

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
    TAKI_CONTEXT_HISTORY_RATIO: ratioKnob(DEFAULT_HISTORY_RATIO),
    // Q14: opt-in streaming usage (`stream_options:{include_usage:true}` on the wire). DEFAULT OFF — gateway
    // compatibility is unverified (T5-R1's verified fact), and the estimator must never depend on usage arriving.
    TAKI_PROVIDER_INCLUDE_USAGE: z.preprocess(parseBooleanFlag, z.boolean().default(false)),
    TAKI_COMPACT_TRIGGER_RATIO: ratioKnob(DEFAULT_COMPACT_TRIGGER_RATIO),
    TAKI_COMPACT_KEEP_MESSAGES: z.coerce.number().int().positive().default(DEFAULT_COMPACT_KEEP_MESSAGES),
  })
  .transform((env) => ({
    contextTokens: {
      main: env.TAKI_PROVIDER_CONTEXT_TOKENS,
      vision: env.TAKI_VLM_CONTEXT_TOKENS,
      utility: env.TAKI_UTILITY_CONTEXT_TOKENS,
    },
    historyRatio: env.TAKI_CONTEXT_HISTORY_RATIO,
    includeUsage: env.TAKI_PROVIDER_INCLUDE_USAGE,
    compact: {
      triggerRatio: env.TAKI_COMPACT_TRIGGER_RATIO,
      keepMessages: env.TAKI_COMPACT_KEEP_MESSAGES,
    },
  }));

export type ContextConfig = z.infer<typeof ContextConfigSchema>;

export function loadContextConfig(env: Record<string, string | undefined>): ContextConfig {
  return ContextConfigSchema.parse({
    TAKI_PROVIDER_CONTEXT_TOKENS: env.TAKI_PROVIDER_CONTEXT_TOKENS,
    TAKI_VLM_CONTEXT_TOKENS: env.TAKI_VLM_CONTEXT_TOKENS,
    TAKI_UTILITY_CONTEXT_TOKENS: env.TAKI_UTILITY_CONTEXT_TOKENS,
    TAKI_CONTEXT_HISTORY_RATIO: env.TAKI_CONTEXT_HISTORY_RATIO,
    TAKI_PROVIDER_INCLUDE_USAGE: env.TAKI_PROVIDER_INCLUDE_USAGE,
    TAKI_COMPACT_TRIGGER_RATIO: env.TAKI_COMPACT_TRIGGER_RATIO,
    TAKI_COMPACT_KEEP_MESSAGES: env.TAKI_COMPACT_KEEP_MESSAGES,
  });
}
