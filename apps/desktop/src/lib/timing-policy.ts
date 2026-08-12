/**
 * INPUT:  config.list entries and an optional typed bootstrap policy.
 * OUTPUT: createTimingPolicyStore() - an in-memory last-good D59/D61 timing policy with atomic validated refresh.
 * POS:    ui/lib - bootstrap-safe Desktop policy authority; Core config remains the only persisted authority.
 */
import {
  TIMING_POLICY_DEVELOPMENT_DEFAULTS,
  TimingPolicySchema,
  timingPolicyCandidate,
  type ConfigEntry,
  type TimingPolicy,
} from "@taki/shared";

export type TimingPolicyUpdate = { ok: true; policy: TimingPolicy } | { ok: false; diagnostic: string };

export interface TimingPolicyStore {
  current(): TimingPolicy;
  apply(entries: readonly ConfigEntry[]): TimingPolicyUpdate;
}

function diagnosticOf(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => `${issue.path.join(".") || "policy"}: ${issue.message}`).join("; ");
}

export function createTimingPolicyStore(initial: TimingPolicy = TIMING_POLICY_DEVELOPMENT_DEFAULTS): TimingPolicyStore {
  let current = initial;
  return {
    current: () => current,
    apply(entries) {
      const parsed = TimingPolicySchema.safeParse(timingPolicyCandidate(entries));
      if (!parsed.success) return { ok: false, diagnostic: diagnosticOf(parsed.error.issues) };
      current = parsed.data;
      return { ok: true, policy: current };
    },
  };
}
