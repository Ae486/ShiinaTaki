/**
 * INPUT:  an AvatarOutcomeResolution from the outcomes registry
 * OUTPUT: avatarToolResult(resolution) -> the model-visible result (design §3.2 table), classified by tool-outcome.ts
 * POS:    core/avatar — the one place the Presentation Outcome maps to a tool result; both avatar tools share it
 */
import type { AvatarOutcomeResolution } from "./avatar-outcomes.ts";

export type AvatarToolResult =
  | { ok: true; outcome: "applied" | "not_rendered" }
  | { ok: false; outcome: "rejected"; code: "AVATAR_REJECTED"; reason: string }
  | { ok: false; outcome: "superseded"; code: "CANCELLED"; state: "cancelled" }
  | { ok: false; outcome: "unknown"; code: "OUTCOME_UNKNOWN"; state: "outcome_unknown" };

export function avatarToolResult(resolution: AvatarOutcomeResolution): AvatarToolResult {
  switch (resolution.outcome) {
    case "applied":
    case "not_rendered":
      return { ok: true, outcome: resolution.outcome };
    case "rejected":
      return { ok: false, outcome: "rejected", code: "AVATAR_REJECTED", reason: resolution.reason ?? "unavailable" };
    case "superseded":
      return { ok: false, outcome: "superseded", code: "CANCELLED", state: "cancelled" };
    case "unknown":
      return { ok: false, outcome: "unknown", code: "OUTCOME_UNKNOWN", state: "outcome_unknown" };
  }
}

/** Shared description tail (PRD R6): what each outcome means and how the model must react. */
export const OUTCOME_GUIDANCE =
  "The result is the Pet window's outcome: applied, not_rendered (no pet window is shown — fine), " +
  "rejected with a reason (motion_busy / speaking / already_active — the avatar is busy or already there; this is " +
  "normal, do NOT retry and do NOT apologize), superseded (replaced by a newer command), or unknown. " +
  "After calling it, add a follow-up message only if you have new substantive content to say — never filler.";
