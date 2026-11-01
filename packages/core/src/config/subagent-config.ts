/**
 * INPUT: existing operator config source with environment > stored > default precedence
 * OUTPUT: validated check-in policy captured at work start or exact check-in continuation
 * POS: core/config — live next-interval reader; never changes a captured wait or active interval
 */
import { SubagentCheckInPolicySchema } from "@taki/shared";
import type { ConfigSource } from "./config-source.ts";
import type { Knob } from "./knob-registry.ts";

export const SUBAGENT_CHECKIN_DEFAULTS = { steps: 50, parentApprovals: 3 } as const;
export const SUBAGENT_CHECKIN_KNOBS: Knob[] = [
  { key: "TAKI_SUBAGENT_CHECKIN_STEPS", schema: SubagentCheckInPolicySchema.shape.steps, default: SUBAGENT_CHECKIN_DEFAULTS.steps,
    apply: "live", input: { kind: "int", min: 1 },
    description: "Completed worker model steps between progress check-ins; captured for the next work/check-in interval." },
  { key: "TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS", schema: SubagentCheckInPolicySchema.shape.parentApprovals, default: SUBAGENT_CHECKIN_DEFAULTS.parentApprovals,
    apply: "live", input: { kind: "int", min: 0 },
    description: "Consecutive main-Agent check-in approvals before user continuation is required; captured for the next interval. Existing user-required waits stay unchanged." },
];
export function readSubagentCheckInPolicy(source: ConfigSource) {
  return SubagentCheckInPolicySchema.parse({ steps: source.resolve("TAKI_SUBAGENT_CHECKIN_STEPS")?.value ?? SUBAGENT_CHECKIN_DEFAULTS.steps,
    parentApprovals: source.resolve("TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS")?.value ?? SUBAGENT_CHECKIN_DEFAULTS.parentApprovals });
}
