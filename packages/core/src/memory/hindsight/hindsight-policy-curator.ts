/**
 * INPUT:  verified due policy/Block work, durable claims and the common application writer/refresh path
 * OUTPUT: scoped production policy reviews, restart-safe publication and actual applied-effect outcomes
 * POS:    core/memory/hindsight — dedicated curator; no generic native maintenance or independent scheduler
 */
import { z } from "zod";
import { MemoryReplicaBankSchema } from "@taki/shared";
import { policyWorkClaim } from "../../db/hindsight-policy-work-repo.ts";
import type { HindsightPolicyWorkRecord } from "../../db/hindsight-policy-work-contract.ts";
import { createCuratorLifetime } from "./hindsight-policy-curator-lifetime.ts";
import { executeCuratorModel, recoverCuratorPolicyAttempt } from "./hindsight-policy-curator-execution.ts";
import { publishCuratorWork } from "./hindsight-policy-curator-publication.ts";
import { assertCuratorWorkCurrent, assertCuratorPolicyReadable, captureCuratorPolicyTarget, captureCuratorBlocks,
  captureCuratorBlockTarget, curatorWritableBlocks, policySourceRef, requireCuratorBank } from "./hindsight-policy-curator-targets.ts";
import type { HindsightPolicyCuratorDeps, HindsightPolicyCuratorOutcome, HindsightPolicyCuratorRun } from "./hindsight-policy-curator-context.ts";

export type { HindsightPolicyCuratorDeps, HindsightPolicyCuratorOutcome } from "./hindsight-policy-curator-context.ts";
export interface HindsightPolicyCurator {
  maybeRun(characterId: string): Promise<void>;
  runNow(characterId: string): Promise<HindsightPolicyCuratorOutcome>;
  stop(): Promise<void>;
  settle(): Promise<void>;
}

export function createHindsightPolicyCurator(deps: HindsightPolicyCuratorDeps): HindsightPolicyCurator {
  const epoch = deps.authority.authorityEpoch();
  if (epoch.providerId !== "hindsight") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const controller = new AbortController(); const active = new Set<Promise<HindsightPolicyCuratorOutcome>>();
  const chains = new Map<string, Promise<HindsightPolicyCuratorOutcome>>();
  const settle = async () => { while (active.size) await Promise.allSettled([...active]); };
  const runNow = (characterId: string): Promise<HindsightPolicyCuratorOutcome> => {
    if (controller.signal.aborted) return Promise.reject(new Error("MEMORY_OPERATION_CANCELLED"));
    z.string().min(1).max(256).parse(characterId);
    const task = (chains.get(characterId) ?? Promise.resolve()).catch(() => undefined)
      .then(() => execute({ deps, characterId, epochId: epoch.epochId, lineage: epoch.providerLineageId, owner: controller.signal }));
    active.add(task); chains.set(characterId, task);
    const release = () => { active.delete(task); if (chains.get(characterId) === task) chains.delete(characterId); };
    void task.then(release, release); return task;
  };
  return { runNow, maybeRun: async (characterId) => { await runNow(characterId); }, settle,
    stop: () => { controller.abort(); return settle(); } };
}

async function execute(input: {
  deps: HindsightPolicyCuratorDeps; characterId: string; epochId: string; lineage: string; owner: AbortSignal;
}): Promise<HindsightPolicyCuratorOutcome> {
  if (input.owner.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
  const read = input.deps.config();
  const config = { memory: { ...read.memory }, policy: { ...read.policy } };
  z.int().min(1).max(2_147_483_647).parse(config.policy.timeoutMs); z.string().parse(config.policy.prompt);
  z.int().positive().parse(config.memory.reportClassCap); z.int().positive().parse(config.memory.tidyMaxSteps);
  const lifetime = createCuratorLifetime(config.policy.timeoutMs, input.owner);
  const run: HindsightPolicyCuratorRun = { ...input, ...lifetime, config,
    outcome: { status: "clean", assessed: 0, blocks: 0, edits: 0, pending: 0, steps: 0 } };
  try {
    run.alive();
    const banks = input.deps.resolveBanks(input.characterId).map((bank) => MemoryReplicaBankSchema.parse(bank))
      .filter((bank) => bank.scope === "global" || bank.characterId === input.characterId)
      .sort((left, right) => left.scope === right.scope ? 0 : left.scope === "global" ? -1 : 1);
    if (new Set(banks.map((bank) => bank.bankId)).size !== banks.length || new Set(banks.map((bank) => bank.scope)).size !== banks.length) {
      throw new Error("MEMORY_AUTHORITY_MISMATCH");
    }
    for (const bank of banks) {
      if (run.signal.aborted) break;
      try { await processBank(run, bank.bankId); }
      catch { run.outcome.status = "failed"; }
    }
    if (run.signal.aborted) run.outcome.status = "failed";
    return { ...run.outcome, usage: input.deps.slot.usage() };
  } finally { lifetime.finish(); }
}

async function processBank(run: HindsightPolicyCuratorRun, bankId: string): Promise<void> {
  const current = requireCuratorBank(run, bankId); const limit = Math.min(run.config.memory.reportClassCap, 1000);
  const model = new Map<string, HindsightPolicyWorkRecord>();
  for (const record of run.deps.work.pending({ ...current.scope, limit })) {
    const claimed = take(run, record); if (!claimed) continue;
    if (await recover(run, claimed)) continue;
    if (!currentTarget(run, claimed)) continue;
    if (claimed.target.kind === "block") await generateAndPublish(run, [claimed]);
    else model.set(claimed.target.native.version.object_id, claimed);
  }
  const refreshed = requireCuratorBank(run, bankId);
  const due = run.deps.replica.duePolicyWork({ ...refreshed.scope, limit,
    at: run.deps.now?.() ?? new Date().toISOString(), eligibleForMaintenance: true });
  for (const entry of due) {
    if (model.size >= limit || model.has(entry.head.object_id)) continue;
    const target = captureCuratorPolicyTarget(run, { ...refreshed, head: entry.head });
    assertCuratorPolicyReadable(run, refreshed.scope, target);
    const record = take(run, run.deps.work.prepare({ scope: refreshed.scope, target }));
    if (record && !await recover(run, record) && currentTarget(run, record)) model.set(target.native.version.object_id, record);
  }
  if (!model.size) return;
  const blocks = captureCuratorBlocks(run, refreshed.bank);
  const sources = [...model.values()].map((record) => {
    if (record.target.kind !== "policy") throw new Error("MEMORY_INTEGRITY_ERROR");
    return policySourceRef(refreshed.scope, record.target);
  });
  const records = [...model.values()];
  for (const blockId of curatorWritableBlocks(refreshed.bank)) {
    const target = captureCuratorBlockTarget(run, { ...refreshed, blockId, sources, blocks });
    const record = take(run, run.deps.work.prepare({ scope: refreshed.scope, target }));
    if (record && !await recover(run, record) && currentTarget(run, record)) records.push(record);
  }
  await generateAndPublish(run, records);
}

function take(run: HindsightPolicyCuratorRun, record: HindsightPolicyWorkRecord): HindsightPolicyWorkRecord | undefined {
  run.alive(); if (record.state === "completed" || record.state === "superseded") return;
  const claimed = run.deps.work.claim({ key: record.key, leaseMs: 2 * run.config.policy.timeoutMs });
  if (!claimed) { run.outcome.pending++; run.outcome.status = "failed"; }
  return claimed;
}
async function recover(run: HindsightPolicyCuratorRun, record: HindsightPolicyWorkRecord): Promise<boolean> {
  if (record.result !== null) { await publishCuratorWork(run, record); return true; }
  if (record.target.kind === "policy" && record.prompt !== null) {
    const failed = recoverCuratorPolicyAttempt(run, record);
    if (failed) await publishCuratorWork(run, failed); return true;
  }
  return false;
}
function currentTarget(run: HindsightPolicyCuratorRun, record: HindsightPolicyWorkRecord): boolean {
  try { assertCuratorWorkCurrent(run, { scope: record.key, target: record.target }); return true; }
  catch {
    if (!run.stopped()) run.deps.work.supersede(policyWorkClaim(record));
    run.outcome.status = "failed"; return false;
  }
}
async function generateAndPublish(run: HindsightPolicyCuratorRun, records: HindsightPolicyWorkRecord[]): Promise<void> {
  const completed = await executeCuratorModel(run, records);
  for (const record of completed) {
    if (run.signal.aborted) {
      if (!run.stopped()) run.deps.work.defer({ claim: policyWorkClaim(record), failure: "publication_pending" });
      run.outcome.pending++; run.outcome.status = "failed"; continue;
    }
    await publishCuratorWork(run, record);
  }
}
