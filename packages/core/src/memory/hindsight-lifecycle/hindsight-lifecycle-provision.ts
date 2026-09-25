/**
 * INPUT:  a bank.provision producer ref, the lifecycle deps (live config, B3 rows, published runtime, client factory) and one
 *         bounded call (signal + phase checkpoints)
 * OUTPUT: provisionHindsightBank() — template/fingerprint/runtime guards, occupancy probe before the first PUT, dry-run,
 *         the unchanged applyHindsightBank, then one full replica run; resolves ready or syncing (with the replica code),
 *         throws a closed lifecycle code for every refusal or setup failure
 * POS:    core/memory/hindsight-lifecycle — R5 producer; never touches another scope's row and never writes Memory Authority
 */
import type { MemoryBankProducerRef, MemoryHindsightLifecycleErrorCode } from "@taki/shared";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { applyHindsightBank, bankProjection, type HindsightBankSetupTarget } from "../hindsight/hindsight-bank-setup.ts";
import type { HindsightClient } from "../hindsight/hindsight-client.ts";
import { hindsightError } from "../hindsight/hindsight-errors.ts";
import { normalizeError } from "../hindsight/hindsight-setup-errors.ts";
import { dryRunTemplates, setupTargets } from "../hindsight/hindsight-setup-stages.ts";
import type { MemoryOperationsRuntime } from "../operations/memory-operation-contract.ts";
import { assertHindsightBankUnoccupied } from "./hindsight-bank-occupancy.ts";
import { hindsightLifecycleErrorCode, type HindsightLifecycleCall, type HindsightLifecycleDeps } from "./hindsight-lifecycle-context.ts";
import { hindsightReplicaBound, readHindsightBankFacts, readHindsightLifecycleLive, type HindsightBankFacts, type HindsightReadyLive } from "./hindsight-lifecycle-reads.ts";

export type HindsightBankPhase = MemoryBankProducerRef["phase"];
export type HindsightProvisionOutcome = { readiness: "ready" } | { readiness: "syncing"; errorCode: MemoryHindsightLifecycleErrorCode };
interface Prepared { live: HindsightReadyLive; runtime: MemoryOperationsRuntime; facts: HindsightBankFacts; target: HindsightBankSetupTarget }

export async function provisionHindsightBank(deps: HindsightLifecycleDeps, input: {
  ref: MemoryBankProducerRef; call: HindsightLifecycleCall<HindsightBankPhase>;
}): Promise<HindsightProvisionOutcome> {
  const { ref, call } = input;
  const { live, runtime, facts, target } = prepare(deps, ref);
  const client = deps.client(live.projection);
  if (facts.row === null) {
    call.checkpoint("probing");
    await assertHindsightBankUnoccupied({ client, bankId: ref.nativeBankId, context: { timeoutMs: live.projection.requestTimeoutMs, signal: call.signal } });
  }
  call.checkpoint("applying");
  const bankRepo = createHindsightBankSetupRepo(deps.db);
  if (facts.row?.status !== "verified") await dryRun({ deps, client, live, target }, call.signal);
  await applyHindsightBank({ deps: { bankRepo, client, connection: live.projection, wait: deps.wait, now: deps.now }, target, signal: call.signal });
  call.checkpoint("syncing");
  return firstSync(deps, { runtime, bankId: ref.nativeBankId, signal: call.signal });
}

/** Every guard is local: a template conflict, a stale fingerprint or an unavailable runtime refuses with zero native calls. */
function prepare(deps: HindsightLifecycleDeps, ref: MemoryBankProducerRef): Prepared {
  const live = readHindsightLifecycleLive(deps);
  if (live.state !== "ready") throw hindsightError("HINDSIGHT_CONNECTION_DISABLED");
  const facts = readHindsightBankFacts(deps.db, { epochId: ref.admittedEpochId, characterId: ref.characterId });
  const revision = live.projection.desiredTemplateRevision;
  if (facts.globalRevision !== revision || ref.templateRevision !== revision
    || (facts.row?.status === "verified" && facts.row.templateRevision !== revision)) throw hindsightError("HINDSIGHT_TEMPLATE_CONFLICT");
  if (live.fingerprint !== ref.configFingerprint || facts.nativeBankId !== ref.nativeBankId) throw hindsightError("HINDSIGHT_STATE_CONFLICT");
  const runtime = deps.runtime();
  if (!runtime || runtime.epochId !== ref.admittedEpochId || !runtime.scheduler.started()) throw new Error("MEMORY_RUNTIME_UNAVAILABLE");
  if (runtime.driftReason() !== "none") throw hindsightError("HINDSIGHT_STATE_CONFLICT");
  const target = setupTargets(revision, ref.characterId).find((candidate) => candidate.binding.scope === "character");
  if (!target || target.binding.externalBankId !== ref.nativeBankId) throw hindsightError("HINDSIGHT_STATE_CONFLICT");
  return { live, runtime, facts, target };
}

/** A rejected template leaves a failed row (readiness `failed`); the first PUT never happens. */
async function dryRun(input: { deps: HindsightLifecycleDeps; client: HindsightClient; live: HindsightReadyLive; target: HindsightBankSetupTarget },
  signal: AbortSignal): Promise<void> {
  const { deps, client, live, target } = input;
  try {
    const results = await dryRunTemplates({ targets: [target], client, connection: live.projection, signal, attemptId: null });
    if (results.some((result) => result.dry_run !== true)) throw hindsightError("HINDSIGHT_TEMPLATE_INVALID");
  } catch (error) {
    if (signal.aborted) throw error;
    createHindsightBankSetupRepo(deps.db).upsert(bankProjection(target, {
      status: "failed", operationIds: [], lastVerifiedAt: null, lastError: normalizeError(error).projection() }));
    throw error;
  }
}

/** Completion is the bound replica, not the verified row: one full run, then the persisted state decides. */
async function firstSync(deps: HindsightLifecycleDeps, input: { runtime: MemoryOperationsRuntime; bankId: string; signal: AbortSignal }):
Promise<HindsightProvisionOutcome> {
  const { runtime, bankId, signal } = input;
  const requestedAt = Date.parse(deps.now());
  try {
    runtime.scheduler.requestManual(bankId, "full");
    await Promise.race([runtime.scheduler.tick(), aborted(signal)]);
  } catch (error) {
    return { readiness: "syncing", errorCode: hindsightLifecycleErrorCode(error) };
  }
  const status = runtime.scheduler.status(bankId)[0];
  if (status?.lastSuccessAt && Date.parse(status.lastSuccessAt) >= requestedAt && hindsightReplicaBound(deps.db, { epochId: runtime.epochId, bankId })) {
    return { readiness: "ready" };
  }
  return { readiness: "syncing", errorCode: status?.errorCode ?? runtime.scheduler.lastError() ?? "HINDSIGHT_REPLICA_SYNC_FAILED" };
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
