/**
 * INPUT:  persisted review progress, effective settings/User Timezone and the Core clock
 * OUTPUT: calendar occurrences coalesced without erasing overdue or partially completed work
 * POS:    core/memory/hindsight — uses the existing calendar adapter; never admits a Scheduled Agent Run
 */
import type { SchedulePattern } from "@taki/shared";
import type { HindsightPolicyReviewConfig } from "../../config/hindsight-policy-config.ts";
import type { HindsightPolicyReviewProgress } from "../../db/hindsight-policy-review-repo.ts";
import { policyWorkValueHash, type HindsightPolicyWorkScope } from "../../db/hindsight-policy-work-contract.ts";
import { createSchedulePatternAdapter } from "../../scheduler/schedule-pattern.ts";

const patterns = createSchedulePatternAdapter();
export function policyScheduleRevision(config: HindsightPolicyReviewConfig, timezone: string): string {
  return policyWorkValueHash({ config, timezone });
}
export function reconcilePolicySchedule(input: {
  previous?: HindsightPolicyReviewProgress; scope: HindsightPolicyWorkScope; config: HindsightPolicyReviewConfig;
  timezone: string; at: string; startup: boolean;
}): HindsightPolicyReviewProgress {
  const { config, timezone, at } = input;
  const revision = policyScheduleRevision(config, timezone);
  const anchorAt = input.previous?.anchorAt ?? at;
  const pattern: SchedulePattern = config.mode === "interval" ? { kind: "every", everyMs: config.intervalMs, anchorAt }
    : { kind: "cron", expression: `${Number(config.time.slice(3))} ${Number(config.time.slice(0, 2))} * * *` };
  patterns.validate(pattern, timezone);
  const next = () => {
    const slot = patterns.next(pattern, timezone, new Date(at));
    if (!slot) throw new Error("HINDSIGHT_POLICY_SCHEDULE_INVALID");
    return slot.scheduledFor;
  };
  const value: HindsightPolicyReviewProgress = input.previous ? { ...input.previous } : {
    scope: input.scope, scheduleRevision: revision, anchorAt, nextDueAt: next(), pending: null,
    lastAttempted: null, lastCompleted: null, catchUpOccurrenceId: null, state: null,
    retryAt: null, failures: 0, eligibleRemaining: null, savedAwaitingPublication: null, observedStateCursor: null,
  };
  // Consume the old calendar's overdue obligation before applying a new timezone or setting.
  if (value.nextDueAt <= at) {
    requirePolicyOccurrence(value, { at: value.nextDueAt, reason: input.startup ? "catch-up" : "scheduled" });
    value.nextDueAt = next();
  }
  if (value.scheduleRevision !== revision) { value.scheduleRevision = revision; value.nextDueAt = next(); }
  if (input.startup && value.pending) {
    value.catchUpOccurrenceId = value.pending.id;
    if (value.state === "running") value.state = "pending";
  }
  return value;
}

export function requirePolicyOccurrence(value: HindsightPolicyReviewProgress,
  input: { at: string; reason: NonNullable<HindsightPolicyReviewProgress["pending"]>["reason"] }): void {
  if (!value.pending) {
    value.pending = { ...input, id: `policy-review:${policyWorkValueHash({ scope: value.scope, revision: value.scheduleRevision, ...input })}` };
    value.state = "pending";
  }
  if (input.reason === "catch-up") value.catchUpOccurrenceId = value.pending.id;
}
