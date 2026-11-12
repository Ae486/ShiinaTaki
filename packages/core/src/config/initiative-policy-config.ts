/**
 * INPUT: effective Core config values, including prospective operator changes
 * OUTPUT: one validated initiative policy with independently bounded admission, output and holding
 * POS: core/config — scalar settings only; User Timezone remains its own authority
 */
import { z } from "zod";
import type { ConfigValue } from "@taki/shared";
import type { ConfigSource } from "./config-source.ts";

// Class B calibration is ratified in docs/T4-HANDOFF.md section 5.4. The Scheduled
// lifetime preserves the existing development default and remains independent of Class B.
export const INITIATIVE_POLICY_FIELDS = {
  modelHourLimit: { key: "TAKI_INITIATIVE_MODEL_HOUR_LIMIT", default: 4 },
  utteranceHourLimit: { key: "TAKI_INITIATIVE_UTTERANCE_HOUR_LIMIT", default: 2 },
  utteranceDayLimit: { key: "TAKI_INITIATIVE_UTTERANCE_DAY_LIMIT", default: 8 },
  utteranceGapMs: { key: "TAKI_INITIATIVE_UTTERANCE_GAP_MS", default: 600_000 },
  busyMaxWaitMs: { key: "TAKI_INITIATIVE_BUSY_MAX_WAIT_MS", default: 90_000 },
  outputTtlMs: { key: "TAKI_INITIATIVE_OUTPUT_TTL_MS", default: 600_000 },
  scheduledOutputTtlMs: { key: "TAKI_SCHEDULED_OUTPUT_TTL_MS", default: 86_400_000 },
} as const;
const Bound = z.number().int().positive().max(2_147_483_647);
const PolicySchema = z.strictObject({ modelHourLimit: Bound, utteranceHourLimit: Bound, utteranceDayLimit: Bound,
  utteranceGapMs: Bound, busyMaxWaitMs: Bound, outputTtlMs: Bound, scheduledOutputTtlMs: Bound })
  .refine((value) => value.utteranceHourLimit <= value.utteranceDayLimit, "hour limit exceeds day limit");
export type InitiativePolicy = z.infer<typeof PolicySchema>;

function candidate(source: ConfigSource, change?: { key: string; value: ConfigValue | null }) {
  return Object.fromEntries(Object.entries(INITIATIVE_POLICY_FIELDS).map(([field, entry]) => [field,
    change?.key === entry.key ? change.value ?? entry.default : source.resolve(entry.key)?.value ?? entry.default]));
}

export function readInitiativePolicy(source: ConfigSource): InitiativePolicy {
  return PolicySchema.parse(candidate(source));
}

export function validateInitiativeConfigChange(source: ConfigSource, change: { key: string; value: ConfigValue | null }): string | null {
  if (!Object.values(INITIATIVE_POLICY_FIELDS).some((entry) => entry.key === change.key)) return null;
  const result = PolicySchema.safeParse(candidate(source, change));
  return result.success ? null : result.error.issues[0]?.message ?? "invalid initiative policy";
}
