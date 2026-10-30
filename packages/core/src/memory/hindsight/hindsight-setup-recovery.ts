/**
 * INPUT:  the persisted B3 setup snapshot and per-Bank setup rows left behind by a previous Core process
 * OUTPUT: reconcileInterruptedSetup() — a busy phase becomes failed/HINDSIGHT_SETUP_INTERRUPTED; intermediate Banks return to pending
 * POS:    core/memory/hindsight — boot-time reconciliation only; asserts nothing about the remote effect and never selects authority
 */
import type { HindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import type { HindsightConnectionRepo } from "../../db/hindsight-connection-repo.ts";
import { hindsightError } from "./hindsight-errors.ts";
import { BUSY_SETUP_PHASES } from "./hindsight-setup-service.ts";

interface RecoveryDeps { connectionRepo: HindsightConnectionRepo; bankRepo: HindsightBankSetupRepo }
export interface InterruptedSetupReport { previousPhase: string; banksReset: number }

export function reconcileInterruptedSetup(deps: RecoveryDeps, now: () => string): InterruptedSetupReport | null {
  const current = deps.connectionRepo.read(deps.bankRepo.list());
  if (!(BUSY_SETUP_PHASES as readonly string[]).includes(current.phase)) return null;
  let banksReset = 0;
  // dry-run-ok/applied rows only witness a partial remote sequence; the next idempotent setup re-verifies them.
  for (const bank of current.banks) {
    if (bank.status === "verified" || bank.status === "pending" || bank.status === "failed") continue;
    deps.bankRepo.upsert({ ...bank, status: "pending", operationIds: [], lastError: null });
    banksReset += 1;
  }
  const banks = deps.bankRepo.list();
  deps.connectionRepo.save({
    ...current, phase: "failed", attemptId: null, banks, revision: current.revision + 1, updatedAt: now(),
    latestError: hindsightError("HINDSIGHT_SETUP_INTERRUPTED").projection(),
  }, current.revision);
  return { previousPhase: current.phase, banksReset };
}
