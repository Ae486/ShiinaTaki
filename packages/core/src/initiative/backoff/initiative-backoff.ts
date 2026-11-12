/**
 * INPUT: real C2 feedback, canonical admissions, primary engagement and explicit reset
 * OUTPUT: conservative 1x/2x/4x/daily Class B eligibility and semantic Monitor status
 * POS: core/initiative/backoff — tightens the shared pipeline; never dispatches or refunds budgets
 */
import { InitiativeBackoffStatusSchema, type InitiativeBackoffStatus } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { readBackoffEvidence, recoverBackoffEngagement, resetBackoffByOperator } from "./backoff-repo.ts";
import { readBackoffAdmissions, captureBackoffAdmission } from "./backoff-admissions.ts";

export interface InitiativeBackoff {
  read(characterId: string): InitiativeBackoffStatus;
  /** Admission gate only: a newly counted Run must not revoke its own execution or delivery. */
  refusal(characterId: string): "backoff-spacing" | "backoff-daily" | undefined;
  reset(characterId: string): InitiativeBackoffStatus;
  observeUserTurn(characterId: string): void;
  /** Call synchronously after a NEW admission with its captured zone; never relabel a reused Run. */
  recordAdmission(runId: string, timezone?: string): void;
}
interface Dependencies {
  db: Database; now?: () => number;
  timezone(): string;
  modelIntervalMs(): number;
  onChanged?(characterId: string): void;
}

export function createInitiativeBackoff(input: Dependencies): InitiativeBackoff {
  const now = input.now ?? Date.now;
  const observeUserTurn = (characterId: string) => {
    if (recoverBackoffEngagement(input.db, { characterId, now: now() })) notify(input, characterId);
  };
  const read = (characterId: string) => {
    observeUserTurn(characterId);
    return readStatus(input, { characterId, now: now() });
  };
  return {
    read, observeUserTurn,
    refusal: (characterId) => read(characterId).refusal ?? undefined,
    reset(characterId) {
      resetBackoffByOperator(input.db, { characterId, now: now() });
      notify(input, characterId);
      return read(characterId);
    },
    recordAdmission: (runId, timezone = input.timezone()) => captureBackoffAdmission(input.db, { runId, timezone }),
  };
}

function readStatus(input: Dependencies, scope: { characterId: string; now: number }): InitiativeBackoffStatus {
  const evidence = readBackoffEvidence(input.db, scope);
  const admissions = readBackoffAdmissions(input.db, { ...scope, timezone: input.timezone() });
  const count = evidence.qualifiedWeakCount;
  const stage = count >= 9 ? "daily" : count >= 6 ? "quadruple" : count >= 3 ? "double" : "normal";
  const spacingMultiplier = stage === "normal" ? 1 : stage === "double" ? 2 : 4;
  const interval = input.modelIntervalMs();
  if (!Number.isSafeInteger(interval) || interval <= 0) throw new Error("BACKOFF_CADENCE_REQUIRED");
  // At 1x the existing jittered cadence remains authoritative. Subsequent stages can only tighten it.
  const spacingUntil = stage !== "normal" && admissions.lastAt !== undefined
    ? admissions.lastAt + interval * spacingMultiplier : undefined;
  const dailyUntil = stage === "daily" ? admissions.dailyUntil : undefined;
  const next = Math.max(spacingUntil ?? 0, dailyUntil ?? 0);
  const refusal = dailyUntil !== undefined && dailyUntil > scope.now ? "backoff-daily"
    : spacingUntil !== undefined && spacingUntil > scope.now ? "backoff-spacing" : null;
  return InitiativeBackoffStatusSchema.parse({ stage, qualifiedWeakCount: count, spacingMultiplier,
    dailyJudgments: admissions.dailyJudgments, nextEligibleAt: next > scope.now ? new Date(next).toISOString() : null,
    refusal, lastResetAt: evidence.reset?.resetAt ?? null, lastResetReason: evidence.reset?.reason ?? null,
    windowSince: evidence.windowSince, observedAt: new Date(scope.now).toISOString() });
}

function notify(input: Dependencies, characterId: string): void {
  try { input.onChanged?.(characterId); }
  catch { /* Policy and producer evidence are already committed; observer failure cannot undo them. */ }
}
