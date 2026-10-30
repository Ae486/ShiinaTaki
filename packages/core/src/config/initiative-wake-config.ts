/**
 * INPUT: effective Core scalar settings and proposed operator changes
 * OUTPUT: validated shared cadence, source enablement and User Timezone quiet-hours policy
 * POS: core/config — no timezone authority or second quota store
 */
import { z } from "zod";
import type { ConfigValue } from "@taki/shared";
import type { ConfigSource } from "./config-source.ts";

export const INITIATIVE_WAKE_FIELDS = {
  periodicEnabled: { key: "TAKI_INITIATIVE_PERIODIC_ENABLED", default: true },
  eventsEnabled: { key: "TAKI_INITIATIVE_EVENTS_ENABLED", default: true },
  checkIntervalMs: { key: "TAKI_INITIATIVE_CHECK_INTERVAL_MS", default: 60_000 },
  modelCadenceMs: { key: "TAKI_INITIATIVE_MODEL_CADENCE_MS", default: 900_000 },
  jitterRatio: { key: "TAKI_INITIATIVE_JITTER_RATIO", default: 0.2 },
  quietStart: { key: "TAKI_INITIATIVE_QUIET_START", default: "23:00" },
  quietEnd: { key: "TAKI_INITIATIVE_QUIET_END", default: "08:00" },
} as const;
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const WakePolicySchema = z.strictObject({ periodicEnabled: z.boolean(), eventsEnabled: z.boolean(),
  checkIntervalMs: z.number().int().min(1_000).max(3_600_000),
  modelCadenceMs: z.number().int().min(300_000).max(86_400_000), jitterRatio: z.number().min(0).max(0.5),
  quietStart: Clock, quietEnd: Clock,
});
export type InitiativeWakePolicy = z.infer<typeof WakePolicySchema>;
function candidate(source: ConfigSource, change?: { key: string; value: ConfigValue | null }) {
  return Object.fromEntries(Object.entries(INITIATIVE_WAKE_FIELDS).map(([name, field]) => [name,
    change?.key === field.key ? change.value ?? field.default : source.resolve(field.key)?.value ?? field.default]));
}
export function readInitiativeWakePolicy(source: ConfigSource): InitiativeWakePolicy {
  return WakePolicySchema.parse(candidate(source));
}
export function validateInitiativeWakeChange(source: ConfigSource, change: { key: string; value: ConfigValue | null }): string | null {
  if (!Object.values(INITIATIVE_WAKE_FIELDS).some((field) => field.key === change.key)) return null;
  const parsed = WakePolicySchema.safeParse(candidate(source, change));
  return parsed.success ? null : parsed.error.issues[0]?.message ?? "invalid wake policy";
}
