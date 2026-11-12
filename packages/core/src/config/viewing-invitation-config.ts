/**
 * INPUT: the existing Core config source and operator-approved first-version invitation defaults
 * OUTPUT: live configurable effective-viewing, remaining-time and offer-lifetime policy
 * POS: core/config — rows in the shared settings registry; no separate configuration store
 */
import { z } from "zod";
import type { ConfigSource } from "./config-source.ts";
import type { Knob } from "./knob-registry.ts";

export const VIEWING_INVITATION_FIELDS = {
  effectivePlaybackMs: { key: "TAKI_INITIATIVE_VIEWING_EFFECTIVE_MS", default: 60_000 },
  minimumRemainingSeconds: { key: "TAKI_INITIATIVE_VIEWING_REMAINING_SECONDS", default: 120 },
  invitationTtlMs: { key: "TAKI_INITIATIVE_VIEWING_INVITATION_TTL_MS", default: 120_000 },
} as const;
// Positive bounded intervals prevent accidental zero-delay invitation loops and timer overflow.
const durationMs = z.int().min(1_000).max(86_400_000);
const remainingSeconds = z.int().min(1).max(86_400);
const Policy = z.strictObject({ effectivePlaybackMs: durationMs,
  minimumRemainingSeconds: remainingSeconds, invitationTtlMs: durationMs });

export const VIEWING_INVITATION_KNOBS: Knob[] = Object.entries(VIEWING_INVITATION_FIELDS).map(([name, field]) => ({
  ...field, schema: Policy.shape[name as keyof typeof VIEWING_INVITATION_FIELDS], apply: "live",
  input: name === "minimumRemainingSeconds" ? { kind: "int", min: 1, max: 86_400 }
    : { kind: "int", min: 1_000, max: 86_400_000 },
  description: `Detected-viewing ${name}; effective elapsed viewing excludes seeks, pause and hidden playback.`,
}));

export function readViewingInvitationPolicy(source: ConfigSource): z.infer<typeof Policy> {
  return Policy.parse(Object.fromEntries(Object.entries(VIEWING_INVITATION_FIELDS).map(([name, field]) =>
    [name, source.resolve(field.key)?.value ?? field.default])));
}
