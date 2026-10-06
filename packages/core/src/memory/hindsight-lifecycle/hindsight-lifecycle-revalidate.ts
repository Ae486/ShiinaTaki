/**
 * INPUT:  a connection.revalidate producer ref, the lifecycle deps (marker, live config, B3 rows, published runtime, binding
 *         seam) and one bounded call (signal + phase checkpoints)
 * OUTPUT: revalidateHindsightConnection() — refuses Stage 4/5 changes, re-admits the provider under the epoch's lineage,
 *         export-verifies every verified Bank without writing rows, records the fingerprint + deployment mode + compatibility
 *         + admission evidence, then either requests a verified reconnect (runtime already on this fingerprint) or replaces
 *         the binding
 * POS:    core/memory/hindsight-lifecycle — R6/R7 producer; never marks Banks pending, never writes Memory Authority
 */
import type { MemoryConnectionProducerRef, MemoryHindsightLifecycleErrorCode } from "@taki/shared";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../db/hindsight-connection-repo.ts";
import { createHindsightRuntimeAdmissionRepo } from "../../db/hindsight-runtime-admission-repo.ts";
import { admitHindsightApplication } from "../hindsight/hindsight-application-capability.ts";
import type { HindsightCallContext, HindsightClient } from "../hindsight/hindsight-client.ts";
import { projectHindsightCompatibilityManifest } from "../hindsight/hindsight-compatibility-service.ts";
import type { HindsightCompatibilityWire } from "../hindsight/hindsight-contracts.ts";
import { hindsightError } from "../hindsight/hindsight-errors.ts";
import { loadTakiBankTemplate, verifyTakiBankTemplate } from "../hindsight/taki-bank-template-v1.ts";
import { hindsightRuntimeAvailability } from "../hindsight-runtime-binding.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { hindsightLifecycleErrorCode, type HindsightLifecycleCall, type HindsightLifecycleDeps } from "./hindsight-lifecycle-context.ts";
import { hindsightRevalidateBlocker, readHindsightLifecycleLive, type HindsightReadyLive } from "./hindsight-lifecycle-reads.ts";

export type HindsightConnectionPhase = MemoryConnectionProducerRef["phase"];
export type HindsightRevalidateOutcome =
  | { outcome: "unchanged" | "rebound"; fingerprint: string }
  | { outcome: "binding_unavailable"; fingerprint: string; errorCode: MemoryHindsightLifecycleErrorCode };
type Call = HindsightLifecycleCall<HindsightConnectionPhase>;

export async function revalidateHindsightConnection(deps: HindsightLifecycleDeps, input: { ref: MemoryConnectionProducerRef; call: Call }):
Promise<HindsightRevalidateOutcome> {
  const { ref, call } = input;
  const { live, lineage } = prepare(deps, ref);
  const client = deps.client(live.projection);
  const request = (): HindsightCallContext => {
    if (call.signal.aborted) throw call.signal.reason;
    const selected = readMemoryAuthoritySelection(deps.db);
    if (selected.mode !== "hindsight" || selected.epochId !== ref.epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    return { timeoutMs: live.projection.requestTimeoutMs, signal: call.signal };
  };
  call.checkpoint("validating");
  const admitted = await admitHindsightApplication({ client, request, expectedLineage: lineage });
  call.checkpoint("verifying-banks");
  await verifyBanks(deps, { client, request });
  request();
  call.checkpoint("recording");
  record(deps, { epochId: ref.epochId, live, manifest: admitted.manifest });
  return rebind(deps, { ref, live, call });
}

/** Every refusal is local: a foreign marker, a disabled or moved connection, or a Stage 4/5 change never reaches the provider. */
function prepare(deps: HindsightLifecycleDeps, ref: MemoryConnectionProducerRef): { live: HindsightReadyLive; lineage: string } {
  const selection = readMemoryAuthoritySelection(deps.db);
  if (selection.mode !== "hindsight" || selection.epochId !== ref.epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const epoch = createCanonicalMemoryAuthorityRepo(deps.db).authorityEpoch(ref.epochId);
  const live = readHindsightLifecycleLive(deps);
  if (live.state !== "ready") throw hindsightError("HINDSIGHT_CONNECTION_DISABLED");
  if (live.fingerprint !== ref.fingerprintAfter) throw hindsightError("HINDSIGHT_STATE_CONFLICT");
  const runtime = deps.runtime();
  const blocker = hindsightRevalidateBlocker(deps.db, { live, runtime: runtime?.epochId === ref.epochId ? runtime : null });
  if (blocker) throw hindsightError(blocker);
  return { live, lineage: epoch.providerLineageId };
}

async function verifyBanks(deps: HindsightLifecycleDeps, input: { client: HindsightClient; request: () => HindsightCallContext }): Promise<void> {
  for (const row of createHindsightBankSetupRepo(deps.db).list()) {
    if (row.status !== "verified") continue;
    verifyTakiBankTemplate(await input.client.exportTemplate(row.externalBankId, input.request()), loadTakiBankTemplate(row.templateRevision, row.scope));
  }
}

/** The reviewed fingerprint and mode move without markAllPending: the Banks were just proven intact on the new connection. */
function record(deps: HindsightLifecycleDeps, input: { epochId: string; live: HindsightReadyLive; manifest: HindsightCompatibilityWire }): void {
  const repo = createHindsightConnectionRepo(deps.db);
  const current = repo.read(createHindsightBankSetupRepo(deps.db).list());
  const at = deps.now();
  repo.save({ ...current, revision: current.revision + 1, configFingerprint: input.live.fingerprint,
    compatibility: projectHindsightCompatibilityManifest(input.manifest), latestError: null, lastSuccessAt: at, updatedAt: at }, current.revision,
    input.live.projection.deploymentMode);
  createHindsightRuntimeAdmissionRepo(deps.db).save({ authorityEpochId: input.epochId, configFingerprint: input.live.fingerprint,
    manifest: input.manifest, admittedAt: at });
}

/** A runtime already built on this fingerprint only needs its parked Banks caught up (R7); anything else is swapped. */
async function rebind(deps: HindsightLifecycleDeps, input: { ref: MemoryConnectionProducerRef; live: HindsightReadyLive; call: Call }):
Promise<HindsightRevalidateOutcome> {
  const { ref, live, call } = input;
  const runtime = deps.runtime();
  if (hindsightRuntimeAvailability(deps.binding()).available && runtime?.epochId === ref.epochId && runtime.configFingerprint === live.fingerprint) {
    runtime.scheduler.verifiedReconnect();
    return { outcome: "unchanged", fingerprint: live.fingerprint };
  }
  call.checkpoint("rebinding");
  try { await deps.replaceBinding(ref.epochId); }
  catch (error) {
    deps.logger.warn({ epochId: ref.epochId, code: hindsightLifecycleErrorCode(error) }, "Hindsight runtime was not rebound after revalidation");
    return { outcome: "binding_unavailable", fingerprint: live.fingerprint, errorCode: hindsightLifecycleErrorCode(error, "MEMORY_RUNTIME_UNAVAILABLE") };
  }
  return { outcome: "rebound", fingerprint: live.fingerprint };
}
