/**
 * INPUT: the shared wake-policy field definitions and schema
 * OUTPUT: operator-visible live settings with matching validators and rendering hints
 * POS: core/config — extends the existing registry; no second settings store
 */
import { z } from "zod";
import type { ConfigInput } from "@taki/shared";
import type { Knob } from "./knob-registry.ts";
import { INITIATIVE_WAKE_FIELDS, WakePolicySchema } from "./initiative-wake-config.ts";

export const INITIATIVE_TARGET_KEY = "TAKI_INITIATIVE_TARGET_CHARACTER";
export const INITIATIVE_WAKE_KNOBS: Knob[] = [
  { key: INITIATIVE_TARGET_KEY, schema: z.string().trim().min(1).max(200), default: null,
    apply: "live", input: { kind: "string" }, description: "Explicit initiative Character target; unset disables eligibility without selecting imported assets." },
  ...Object.entries(INITIATIVE_WAKE_FIELDS).map(([field, value]): Knob => ({
    ...value, schema: WakePolicySchema.shape[field as keyof typeof INITIATIVE_WAKE_FIELDS],
    apply: "live", input: inputHint(field, value.default),
    description: `Initiative ${field}; periodic and event sources share global limits.`,
  })),
];

function inputHint(field: string, value: string | number | boolean): ConfigInput {
  if (typeof value === "boolean") return { kind: "boolean" };
  if (typeof value === "string") return { kind: "string" };
  if (field === "jitterRatio") return { kind: "number", min: 0, max: 0.5 };
  return field === "checkIntervalMs" ? { kind: "int", min: 1000, max: 3_600_000 }
    : { kind: "int", min: 300_000, max: 86_400_000 };
}
