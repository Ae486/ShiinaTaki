/**
 * INPUT:  config.list timing rows or a complete candidate timing policy.
 * OUTPUT: shared timing config keys, development defaults, policy schema, and config-row projection helpers.
 * POS:    shared/protocol policy - the single D59/D61 timing vocabulary consumed by Core and Desktop; no Rust mirror.
 */
import { z } from "zod";
import type { ConfigEntry } from "./config-schema.ts";

export const TIMING_CONFIG_KEYS = {
  reconnectBaseMs: "TAKI_RECONNECT_BASE_MS",
  reconnectCapMs: "TAKI_RECONNECT_CAP_MS",
  reconnectStabilityResetMs: "TAKI_RECONNECT_STABILITY_RESET_MS",
  openAuthMs: "TAKI_WS_OPEN_AUTH_TIMEOUT_MS",
  interactiveRpcMs: "TAKI_RPC_INTERACTIVE_TIMEOUT_MS",
  longRpcMs: "TAKI_RPC_LONG_TIMEOUT_MS",
  chatAckMs: "TAKI_CHAT_ACK_TIMEOUT_MS",
  petCostumeTotalMs: "TAKI_PET_COSTUME_TOTAL_TIMEOUT_MS",
  rendererLoadMs: "TAKI_RENDERER_LOAD_TIMEOUT_MS",
  homeResultMs: "TAKI_HOME_RESULT_TIMEOUT_MS",
} as const;

export type TimingPolicyField = keyof typeof TIMING_CONFIG_KEYS;
export type TimingConfigKey = (typeof TIMING_CONFIG_KEYS)[TimingPolicyField];

export const TimingDurationMsSchema = z.int().positive();

export const TimingPolicySchema = z
  .object({
    reconnectBaseMs: TimingDurationMsSchema,
    reconnectCapMs: TimingDurationMsSchema,
    reconnectStabilityResetMs: TimingDurationMsSchema,
    openAuthMs: TimingDurationMsSchema,
    interactiveRpcMs: TimingDurationMsSchema,
    longRpcMs: TimingDurationMsSchema,
    chatAckMs: TimingDurationMsSchema,
    petCostumeTotalMs: TimingDurationMsSchema,
    rendererLoadMs: TimingDurationMsSchema,
    homeResultMs: TimingDurationMsSchema,
  })
  .superRefine((policy, ctx) => {
    if (policy.reconnectBaseMs > policy.reconnectCapMs) {
      ctx.addIssue({ code: "custom", path: ["reconnectBaseMs"], message: "must not exceed reconnectCapMs" });
    }
    if (policy.rendererLoadMs >= policy.petCostumeTotalMs) {
      ctx.addIssue({ code: "custom", path: ["rendererLoadMs"], message: "must be less than petCostumeTotalMs" });
    }
    if (policy.petCostumeTotalMs >= policy.homeResultMs) {
      ctx.addIssue({ code: "custom", path: ["petCostumeTotalMs"], message: "must be less than homeResultMs" });
    }
  });
export type TimingPolicy = z.infer<typeof TimingPolicySchema>;

/** Owner-approved development profile. Runtime evidence, not code churn, will determine the final product defaults. */
export const TIMING_POLICY_DEVELOPMENT_DEFAULTS: TimingPolicy = TimingPolicySchema.parse({
  reconnectBaseMs: 500,
  reconnectCapMs: 10_000,
  reconnectStabilityResetMs: 10_000,
  openAuthMs: 10_000,
  interactiveRpcMs: 15_000,
  longRpcMs: 120_000,
  chatAckMs: 15_000,
  petCostumeTotalMs: 40_000,
  rendererLoadMs: 30_000,
  homeResultMs: 45_000,
});

const TIMING_KEYS: ReadonlySet<string> = new Set(Object.values(TIMING_CONFIG_KEYS));

export function isTimingConfigKey(key: string): key is TimingConfigKey {
  return TIMING_KEYS.has(key);
}

/** Projects config.list rows into the camel-cased object validated by TimingPolicySchema. */
export function timingPolicyCandidate(entries: readonly Pick<ConfigEntry, "key" | "value">[]): Record<TimingPolicyField, unknown> {
  const values = new Map(entries.map((entry) => [entry.key, entry.value]));
  return {
    reconnectBaseMs: values.get(TIMING_CONFIG_KEYS.reconnectBaseMs),
    reconnectCapMs: values.get(TIMING_CONFIG_KEYS.reconnectCapMs),
    reconnectStabilityResetMs: values.get(TIMING_CONFIG_KEYS.reconnectStabilityResetMs),
    openAuthMs: values.get(TIMING_CONFIG_KEYS.openAuthMs),
    interactiveRpcMs: values.get(TIMING_CONFIG_KEYS.interactiveRpcMs),
    longRpcMs: values.get(TIMING_CONFIG_KEYS.longRpcMs),
    chatAckMs: values.get(TIMING_CONFIG_KEYS.chatAckMs),
    petCostumeTotalMs: values.get(TIMING_CONFIG_KEYS.petCostumeTotalMs),
    rendererLoadMs: values.get(TIMING_CONFIG_KEYS.rendererLoadMs),
    homeResultMs: values.get(TIMING_CONFIG_KEYS.homeResultMs),
  };
}
