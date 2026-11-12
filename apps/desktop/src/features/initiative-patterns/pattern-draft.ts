/**
 * INPUT: operator form values and supported Shared condition definitions.
 * OUTPUT: editable default proposal, finite condition constructors and local datetime conversion.
 * POS: Desktop form helpers; defaults are editable proposals and never active runtime policy.
 */
import type { InteractionPatternCondition, InteractionPatternDefinition } from "@taki/shared";

export function newPatternDraft(): InteractionPatternDefinition {
  return {
    title: "", purpose: "", conditions: { all: [{ kind: "presence_present" }] }, contextSelectors: [],
    allowedOutcomes: ["silent", "speak"], timing: { minimumGapMinutes: 60, chance: 1 },
    lifetime: { startsAt: null, expiresAt: null },
  };
}

export function newCondition(kind: string): InteractionPatternCondition | null {
  switch (kind) {
    case "local_time_window": return { kind, start: "09:00", end: "18:00", daysOfWeek: [1, 2, 3, 4, 5] };
    case "application_in_set": return { kind, applications: [""] };
    case "activity_dwell_at_least": return { kind, minutes: 30 };
    case "known_idle_state": return { kind, state: "active" };
    case "presence_present": return { kind };
    default: return null;
  }
}

export function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function absoluteDateTime(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
