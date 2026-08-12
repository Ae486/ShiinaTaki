/**
 * INPUT:  one proposed config-table timing change and the current effective ConfigSource.
 * OUTPUT: validateTimingConfigChange() -> null or an actionable cross-field refusal reason.
 * POS:    core/config - prospective D59/D61 policy validation before the single writer mutates the sparse store.
 */
import {
  TIMING_CONFIG_KEYS,
  TimingPolicySchema,
  isTimingConfigKey,
  timingPolicyCandidate,
  type ConfigValue,
} from "@taki/shared";
import type { ConfigSource } from "./config-source.ts";
import { findKnob } from "./knob-registry.ts";

export function validateTimingConfigChange(
  source: ConfigSource,
  change: { key: string; value: ConfigValue | null },
): string | null {
  if (!isTimingConfigKey(change.key)) return null;
  const entries = Object.values(TIMING_CONFIG_KEYS).map((key) => ({
    key,
    value:
      key === change.key
        ? change.value ?? findKnob(key)?.default ?? null
        : source.resolve(key)?.value ?? null,
  }));
  const parsed = TimingPolicySchema.safeParse(timingPolicyCandidate(entries));
  if (parsed.success) return null;
  return parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "policy"}: ${issue.message}`)
    .join("; ");
}
