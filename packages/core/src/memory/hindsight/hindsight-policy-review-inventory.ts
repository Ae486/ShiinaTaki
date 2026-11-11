/**
 * INPUT:  the curator's verified replica/target readers and original per-item work journal
 * OUTPUT: paged eligible assessment inventory excluding saved proposals, with real future retry deadlines
 * POS:    core/memory/hindsight — same eligibility as curator admission; no writes, model calls or replica lease
 */
import { setImmediate } from "node:timers/promises";
import type { MemoryReplicaBank } from "@taki/shared";
import type { HindsightApplicationWorkCursor } from "../../db/hindsight-application-replica-contract.ts";
import { hindsightPolicyWorkIdentity } from "../../db/hindsight-policy-work-contract.ts";
import type { HindsightPolicyCuratorDeps, HindsightPolicyCuratorRun } from "./hindsight-policy-curator-context.ts";
import { createCuratorLifetime } from "./hindsight-policy-curator-lifetime.ts";
import { captureCuratorPolicyTarget, readCuratorSnapshot, requireCuratorBank } from "./hindsight-policy-curator-targets.ts";

export async function inspectPolicyReviewBank(deps: HindsightPolicyCuratorDeps, bank: MemoryReplicaBank, signal: AbortSignal) {
  const epoch = deps.authority.authorityEpoch(); const config = deps.config();
  const lifetime = createCuratorLifetime(config.policy.timeoutMs, signal);
  const run: HindsightPolicyCuratorRun = { deps, config, ...lifetime, characterId: bank.characterId,
    epochId: epoch.epochId, lineage: epoch.providerLineageId,
    outcome: { status: "clean", assessed: 0, blocks: 0, edits: 0, pending: 0, steps: 0 } };
  try { return await inventory(run, bank.bankId); }
  finally { lifetime.finish(); }
}

async function inventory(run: HindsightPolicyCuratorRun, bankId: string) {
  let after: HindsightApplicationWorkCursor | undefined;
  let eligible = 0; let ready = 0; let retryAt: string | null = null;
  const at = run.deps.now?.() ?? new Date().toISOString();
  const scope = requireCuratorBank(run, bankId).scope;
  const stateCursor = run.deps.replica.checkpoint(bankId)?.checkpoint.state_cursor;
  if (stateCursor === undefined) throw new Error("HINDSIGHT_CHECKPOINT_STALE");
  for (;;) {
    const page = readCuratorSnapshot(run, (current) => {
      const binding = requireCuratorBank(current, bankId);
      return current.deps.replica.duePolicyWork({ ...scope, limit: 32, at, after,
        eligibleForMaintenance: true, includeDeferred: true }).map((entry) => {
        const target = captureCuratorPolicyTarget(current, { ...binding, head: entry.head });
        const work = current.deps.work.get({ ...scope, workId: hindsightPolicyWorkIdentity(scope, target) });
        return { cursor: entry.cursor, target, work };
      });
    });
    for (const { target, work } of page) {
      if (work?.result) continue;
      eligible++;
      const next = [at, target.memory.assessment.next_attempt_at, work?.nextAttemptAt, work?.claimUntil]
        .filter((value): value is string => typeof value === "string").sort().at(-1)!;
      if (next <= at) ready++;
      retryAt = [retryAt, next].filter((value): value is string => value !== null).sort()[0]!;
    }
    if (page.length < 32) {
      if (run.deps.replica.checkpoint(bankId)?.checkpoint.state_cursor !== stateCursor) throw new Error("HINDSIGHT_CHECKPOINT_STALE");
      return { scope, eligible, ready, retryAt, stateCursor };
    }
    after = page.at(-1)!.cursor;
    await setImmediate();
  }
}
