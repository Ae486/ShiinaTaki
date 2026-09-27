/**
 * INPUT:  the published Hindsight runtime (write fence, replica scheduler, identity), Core SQLite, the artifact store, the
 *         native backup route, the custody reader and the current catalog's credential read-back
 * OUTPUT: createHindsightBackupService() -> markerEpochId/capture/admit/verify/lastVerified/inventory/sealed/quarantine/returnInbox/stop;
 *         capture runs §5.2 exactly: quiesce -> scheduler stop -> one Core identity read -> Database.backupTo into the partial
 *         dir -> native snapshot, pair check and seal (route c) or the staged native request awaiting backup.admit (route b),
 *         always releasing the fence and restarting a previously started scheduler; every failure is a closed
 *         MemoryBackupErrorCode with no listed artifact
 * POS:    core/memory/hindsight-backup — the backup producer; the operation owner is its only caller
 */
import {
  HindsightBackupNativeProofSchema, type HindsightBackupManifest, type HindsightBackupNativeRequest, type HindsightBackupRoute,
  type HindsightCredentialCustody, type MemoryBackupErrorCode, type MemoryBackupProducerRef,
} from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import type { Logger } from "../../logging/logger.ts";
import type { CanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import type { HindsightReplicaScheduler } from "../hindsight/hindsight-replica-scheduler.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { admitHindsightBackup, type HindsightBackupAdmitInput } from "./hindsight-backup-admit.ts";
import {
  errorMessage, failedOutcome, HindsightBackupFailure, outcomeOf, step, stepAsync, type HindsightBackupOutcome,
} from "./hindsight-backup-failure.ts";
import { readHindsightBackupIdentity, type HindsightBackupIdentity, type HindsightBackupRuntimeIdentity } from "./hindsight-backup-identity.ts";
import { verifyHindsightBackupPair } from "./hindsight-backup-pair.ts";
import type { HindsightNativeBackupRoute, HindsightNativeBackupSnapshot } from "./hindsight-backup-route.ts";
import type { HindsightBackupStagedRecord, HindsightBackupStagedSummary, HindsightBackupStore } from "./hindsight-backup-store.ts";
import { verifyHindsightBackup, type HindsightBackupVerifyInput } from "./hindsight-backup-verify.ts";

const QUIESCE_TIMEOUT_MS = 30_000;
const NATIVE_TIMEOUT_MS = 600_000;

export type HindsightBackupPhase = MemoryBackupProducerRef["phase"];
export interface HindsightBackupRuntime extends HindsightBackupRuntimeIdentity {
  scheduler: Pick<HindsightReplicaScheduler, "started" | "stop" | "start">;
  writeFence: Pick<CanonicalLocalWriteFence, "quiesce" | "release">;
}
export interface HindsightBackupCaptureInput {
  operationId: string; backupId: string; route: HindsightBackupRoute; runtime: HindsightBackupRuntime;
  checkpoint(phase: HindsightBackupPhase): void;
}

export interface HindsightBackupService {
  /** The committed Hindsight epoch from the marker, or null under any other authority. */
  markerEpochId(): string | null;
  /** Route c resolves a sealed verified pair; route b resolves `verifiedAt: null` with the Core half staged for backup.admit. */
  capture(input: HindsightBackupCaptureInput): Promise<HindsightBackupOutcome>;
  admit(input: HindsightBackupAdmitInput): Promise<HindsightBackupOutcome>;
  verify(input: HindsightBackupVerifyInput): Promise<HindsightBackupOutcome>;
  /** The newest sealed backup whose pair is verified; a synchronous local read, re-listed after this service changes one. */
  lastVerified(): HindsightBackupManifest | null;
  /** The status inventory under the same cache: last verified, newest sealed whatever its verification, staged captures. */
  inventory(): HindsightBackupInventory;
  /** The sealed manifest of a backup id, or null; synchronous for boot observation. */
  sealed(backupId: string): HindsightBackupManifest | null;
  /** Boot observation: a leftover partial dir from a dead capture is moved aside, never listed. */
  quarantine(backupId: string): boolean;
  /** Boot observation of a dead admit: a ZIP claimed into the staged dir goes back under its inbox name. */
  returnInbox(backupId: string, fileName: string): boolean;
  /** Aborts an in-flight native snapshot and resolves once the capture released its pause, so the runtime stops after it. */
  stop(): Promise<void>;
}

export interface HindsightBackupInventory {
  lastVerified: HindsightBackupManifest | null;
  latest: HindsightBackupManifest | null;
  staged: HindsightBackupStagedSummary[];
}

export interface HindsightBackupServiceInput {
  db: Database; store: HindsightBackupStore; route: HindsightNativeBackupRoute;
  custody(): HindsightCredentialCustody;
  /** The refs a custody record saw present that the current catalog does not hold. */
  missingCredentials(custody: HindsightCredentialCustody): string[];
  logger: Logger; now?: () => string; quiesceTimeoutMs?: number; nativeTimeoutMs?: number;
}
type Deps = HindsightBackupServiceInput & { now: () => string };

export function createHindsightBackupService(input: HindsightBackupServiceInput): HindsightBackupService {
  const active = new Map<AbortController, Promise<HindsightBackupOutcome>>();
  const deps: Deps = { ...input, now: input.now ?? (() => new Date().toISOString()) };
  let cached: HindsightBackupInventory | null = null;
  const changing = async (work: () => Promise<HindsightBackupOutcome>) => {
    try { return await work(); }
    finally { cached = null; }
  };
  const inventory = () => cached ??= readInventory(input.store);
  return {
    markerEpochId: () => {
      const selection = readMemoryAuthoritySelection(input.db);
      return selection.mode === "hindsight" ? selection.epochId : null;
    },
    capture: (capture) => changing(async () => {
      const controller = new AbortController();
      const run = paused(deps, capture, controller.signal); active.set(controller, run);
      try { return await run; }
      finally { active.delete(controller); }
    }),
    admit: (admit) => changing(() => admitHindsightBackup(deps, admit)),
    verify: (target) => changing(() => verifyHindsightBackup(deps, target)),
    lastVerified: () => inventory().lastVerified,
    inventory,
    sealed: (backupId) => input.store.readSync(backupId),
    quarantine: (backupId) => input.store.quarantine(backupId),
    returnInbox: (backupId, fileName) => input.store.returnInbox(backupId, fileName),
    stop: async () => {
      for (const controller of active.keys()) controller.abort();
      await Promise.allSettled(active.values());
    },
  };
}

function readInventory(store: HindsightBackupStore): HindsightBackupInventory {
  const sealed = store.listSync();
  return { lastVerified: sealed.filter((backup) => backup.verifiedAt !== null).at(-1) ?? null, latest: sealed.at(-1) ?? null,
    staged: store.listStagedSync() };
}

async function paused(deps: Deps, capture: HindsightBackupCaptureInput, signal: AbortSignal): Promise<HindsightBackupOutcome> {
  if (capture.route === "native-endpoint" && !deps.route.available()) return failedOutcome("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE");
  const { runtime } = capture;
  capture.checkpoint("quiescing");
  try { await runtime.writeFence.quiesce({ timeoutMs: deps.quiesceTimeoutMs ?? QUIESCE_TIMEOUT_MS }); }
  catch (error) {
    // A timed-out quiesce reopens the fence itself; nothing else was paused yet.
    return failedOutcome(errorMessage(error) === "MEMORY_QUIESCENCE_TIMEOUT" ? "HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT" : "HINDSIGHT_BACKUP_INTERNAL_ERROR");
  }
  const schedulerWasStarted = runtime.scheduler.started();
  try {
    await runtime.scheduler.stop();
    return { ok: true, verifiedAt: await captureQuiesced(deps, { capture, signal }) };
  } catch (error) {
    return outcomeOf(error, (unexpected) => deps.logger.error({ code: "HINDSIGHT_BACKUP_INTERNAL_ERROR",
      err: unexpected instanceof Error ? unexpected.name : "unknown" }, "backup capture failed"));
  } finally {
    runtime.writeFence.release();
    if (schedulerWasStarted) restartScheduler(runtime, deps.logger);
  }
}

/** Resolves the sealed pair's verifiedAt, or null once a route-b capture is staged for its native ZIP. */
async function captureQuiesced(deps: Deps, work: { capture: HindsightBackupCaptureInput; signal: AbortSignal }): Promise<string | null> {
  const { capture } = work;
  const identity = step(() => readHindsightBackupIdentity(deps.db, capture.runtime), coreReadCode);
  const custody = step(() => deps.custody(), () => "HINDSIGHT_BACKUP_INTERNAL_ERROR");
  const createdAt = deps.now();
  capture.checkpoint("capturing-core");
  await stepAsync(() => deps.store.begin(capture.backupId), () => "HINDSIGHT_BACKUP_STORAGE_FAILED");
  try {
    const core = await stepAsync(() => deps.store.captureCore(capture.backupId, (path) => deps.db.backupTo(path)),
      () => "HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED");
    const staged: HindsightBackupStagedRecord = {
      request: nativeRequest(identity, { backupId: capture.backupId, createdAt }),
      core: { version: 1, backupId: capture.backupId, createdAt, operationId: capture.operationId,
        core: { file: "core.sqlite", ...core, migrationHead: identity.migrationHead }, ...identity.core, custody },
    };
    if (capture.route === "native-endpoint") return await pairAndSeal(deps, { capture, staged, signal: work.signal });
    capture.checkpoint("sealing");
    await stepAsync(() => deps.store.stage(staged), () => "HINDSIGHT_BACKUP_STORAGE_FAILED");
    return null;
  } catch (error) {
    // An unpaired Core copy is never offered as a backup; the partial dir goes with the failure.
    await deps.store.discard(capture.backupId).catch(() => deps.logger.warn({ code: "HINDSIGHT_BACKUP_STORAGE_FAILED" }, "partial backup dir was not removed"));
    throw error;
  }
}

async function pairAndSeal(deps: Deps, input: { capture: HindsightBackupCaptureInput; staged: HindsightBackupStagedRecord; signal: AbortSignal }): Promise<string> {
  const { capture, staged } = input;
  capture.checkpoint("capturing-native");
  const native = await nativeSnapshot(deps, { request: staged.request, signal: input.signal });
  capture.checkpoint("verifying");
  const pair = verifyHindsightBackupPair(staged.core, native.proof);
  if (!pair.ok) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_PAIR_MISMATCH", { reason: pair.reason, bankId: pair.bankId });
  capture.checkpoint("sealing");
  const verifiedAt = deps.now();
  const manifest: HindsightBackupManifest = { ...staged.core, route: "native-endpoint",
    native: { ...native.artifact, nativeManifestVersion: "2", schema: native.schema, proof: native.proof }, sensitive: true, verifiedAt };
  await stepAsync(() => deps.store.seal(manifest), (error) => errorMessage(error) === "HINDSIGHT_BACKUP_ARTIFACT_INVALID"
    ? "HINDSIGHT_BACKUP_INTERNAL_ERROR" : "HINDSIGHT_BACKUP_STORAGE_FAILED");
  return verifiedAt;
}

/** What the native side must snapshot and prove: route c sends it, route b writes it for the operator's native CLI. */
function nativeRequest(identity: HindsightBackupIdentity, input: { backupId: string; createdAt: string }): HindsightBackupNativeRequest {
  return { version: 1, backupId: input.backupId, createdAt: input.createdAt, providerLineageId: identity.core.authority.providerLineageId,
    nativeBankIds: identity.core.banks.map((bank) => bank.nativeBankId), operationIds: identity.operationIds };
}

async function nativeSnapshot(deps: Deps, input: { request: HindsightBackupNativeRequest; signal: AbortSignal }): Promise<HindsightNativeBackupSnapshot> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(deps.nativeTimeoutMs ?? NATIVE_TIMEOUT_MS)]);
  // The fence stays closed until this settles, so a route that ignores its signal must not hold writes past the deadline.
  const snapshot = await stepAsync(() => Promise.race([deps.route.snapshot({ ...input.request, signal }), aborted(signal)]),
    () => "HINDSIGHT_BACKUP_NATIVE_FAILED");
  const proof = HindsightBackupNativeProofSchema.safeParse(snapshot.proof);
  if (!proof.success) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_NATIVE_FAILED");
  return { ...snapshot, proof: proof.data };
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(new Error("HINDSIGHT_BACKUP_NATIVE_FAILED"));
    if (signal.aborted) fail(); else signal.addEventListener("abort", fail, { once: true });
  });
}

function restartScheduler(runtime: HindsightBackupRuntime, logger: Logger): void {
  try { runtime.scheduler.start(); }
  catch (error) { logger.warn({ code: "HINDSIGHT_REPLICA_SCHEDULE_STALE", err: errorMessage(error) }, "replica scheduler did not restart after backup capture"); }
}

function coreReadCode(error: unknown): MemoryBackupErrorCode {
  return errorMessage(error) === "MEMORY_AUTHORITY_MISMATCH" ? "MEMORY_AUTHORITY_MISMATCH" : "HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED";
}
