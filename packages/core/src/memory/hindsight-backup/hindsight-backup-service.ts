/**
 * INPUT:  the published Hindsight runtime (write fence, replica scheduler, identity), Core SQLite, the artifact store, the
 *         native backup route and the custody reader
 * OUTPUT: createHindsightBackupService() -> markerEpochId/capture/quarantine/stop; capture runs §5.2 exactly: quiesce ->
 *         scheduler stop -> one Core identity read -> Database.backupTo into the partial dir -> native snapshot -> pair check
 *         -> seal, always releasing the fence and restarting a previously started scheduler; every failure is a closed
 *         MemoryBackupErrorCode with no listed artifact
 * POS:    core/memory/hindsight-backup — the backup.capture producer; the operation owner is its only caller
 */
import {
  HindsightBackupNativeProofSchema, type HindsightBackupManifest, type HindsightBackupPairMismatch, type HindsightCredentialCustody,
  type MemoryBackupErrorCode, type MemoryBackupProducerRef,
} from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import type { Logger } from "../../logging/logger.ts";
import type { CanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import type { HindsightReplicaScheduler } from "../hindsight/hindsight-replica-scheduler.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { readHindsightBackupIdentity, type HindsightBackupIdentity, type HindsightBackupRuntimeIdentity } from "./hindsight-backup-identity.ts";
import { verifyHindsightBackupPair } from "./hindsight-backup-pair.ts";
import type { HindsightNativeBackupRoute, HindsightNativeBackupSnapshot } from "./hindsight-backup-route.ts";
import type { HindsightBackupStore } from "./hindsight-backup-store.ts";

const QUIESCE_TIMEOUT_MS = 30_000;
const NATIVE_TIMEOUT_MS = 600_000;

export type HindsightBackupPhase = MemoryBackupProducerRef["phase"];
export interface HindsightBackupRuntime extends HindsightBackupRuntimeIdentity {
  scheduler: Pick<HindsightReplicaScheduler, "started" | "stop" | "start">;
  writeFence: Pick<CanonicalLocalWriteFence, "quiesce" | "release">;
}
export interface HindsightBackupCaptureInput {
  operationId: string; backupId: string; runtime: HindsightBackupRuntime;
  checkpoint(phase: HindsightBackupPhase): void;
}
export type HindsightBackupCaptureOutcome =
  | { ok: true; manifest: HindsightBackupManifest }
  | { ok: false; code: MemoryBackupErrorCode; mismatch: HindsightBackupPairMismatch | null };

export interface HindsightBackupService {
  /** The committed Hindsight epoch from the marker, or null under any other authority. */
  markerEpochId(): string | null;
  capture(input: HindsightBackupCaptureInput): Promise<HindsightBackupCaptureOutcome>;
  /** Boot observation: a leftover partial dir from a dead capture is moved aside, never listed. */
  quarantine(backupId: string): boolean;
  /** Aborts an in-flight native snapshot so shutdown is not held by the route. */
  stop(): void;
}

export interface HindsightBackupServiceInput {
  db: Database; store: HindsightBackupStore; route: HindsightNativeBackupRoute;
  custody(): HindsightCredentialCustody;
  logger: Logger; now?: () => string; quiesceTimeoutMs?: number; nativeTimeoutMs?: number;
}

/** A failure already named by its capture step; anything else escaping a step is an internal error. */
class CaptureFailure extends Error {
  readonly code: MemoryBackupErrorCode;
  readonly mismatch: HindsightBackupPairMismatch | null;
  constructor(code: MemoryBackupErrorCode, mismatch: HindsightBackupPairMismatch | null = null) {
    super(code); this.name = "CaptureFailure"; this.code = code; this.mismatch = mismatch;
  }
}

export function createHindsightBackupService(input: HindsightBackupServiceInput): HindsightBackupService {
  const active = new Set<AbortController>();
  return {
    markerEpochId: () => {
      const selection = readMemoryAuthoritySelection(input.db);
      return selection.mode === "hindsight" ? selection.epochId : null;
    },
    capture: async (capture) => {
      const controller = new AbortController(); active.add(controller);
      try { return await paused(input, capture, controller.signal); }
      finally { active.delete(controller); }
    },
    quarantine: (backupId) => input.store.quarantine(backupId),
    stop: () => { for (const controller of active) controller.abort(); },
  };
}

async function paused(deps: HindsightBackupServiceInput, capture: HindsightBackupCaptureInput, signal: AbortSignal): Promise<HindsightBackupCaptureOutcome> {
  if (!deps.route.available()) return failed("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE");
  const { runtime } = capture;
  capture.checkpoint("quiescing");
  try { await runtime.writeFence.quiesce({ timeoutMs: deps.quiesceTimeoutMs ?? QUIESCE_TIMEOUT_MS }); }
  catch (error) {
    // A timed-out quiesce reopens the fence itself; nothing else was paused yet.
    return failed(errorMessage(error) === "MEMORY_QUIESCENCE_TIMEOUT" ? "HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT" : "HINDSIGHT_BACKUP_INTERNAL_ERROR");
  }
  const schedulerWasStarted = runtime.scheduler.started();
  try {
    await runtime.scheduler.stop();
    return { ok: true, manifest: await captureQuiesced(deps, { capture, signal }) };
  } catch (error) {
    if (error instanceof CaptureFailure) return failed(error.code, error.mismatch);
    deps.logger.error({ code: "HINDSIGHT_BACKUP_INTERNAL_ERROR", err: error instanceof Error ? error.name : "unknown" }, "backup capture failed");
    return failed("HINDSIGHT_BACKUP_INTERNAL_ERROR");
  } finally {
    runtime.writeFence.release();
    if (schedulerWasStarted) restartScheduler(runtime, deps.logger);
  }
}

async function captureQuiesced(deps: HindsightBackupServiceInput, work: { capture: HindsightBackupCaptureInput; signal: AbortSignal }): Promise<HindsightBackupManifest> {
  const { capture } = work; const now = deps.now ?? (() => new Date().toISOString());
  const identity = step(() => readHindsightBackupIdentity(deps.db, capture.runtime), coreReadCode);
  const custody = step(() => deps.custody(), () => "HINDSIGHT_BACKUP_INTERNAL_ERROR");
  const createdAt = now();
  capture.checkpoint("capturing-core");
  await stepAsync(() => deps.store.begin(capture.backupId), () => "HINDSIGHT_BACKUP_STORAGE_FAILED");
  try {
    const core = await stepAsync(() => deps.store.captureCore(capture.backupId, (path) => deps.db.backupTo(path)),
      () => "HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED");
    capture.checkpoint("capturing-native");
    const native = await nativeSnapshot(deps, { capture, identity, signal: work.signal });
    capture.checkpoint("verifying");
    const pair = verifyHindsightBackupPair(identity.core, native.proof);
    if (!pair.ok) throw new CaptureFailure("HINDSIGHT_BACKUP_PAIR_MISMATCH", { reason: pair.reason, bankId: pair.bankId });
    capture.checkpoint("sealing");
    const manifest: HindsightBackupManifest = { version: 1, backupId: capture.backupId, createdAt, operationId: capture.operationId,
      route: "native-endpoint", core: { file: "core.sqlite", ...core, migrationHead: identity.migrationHead },
      native: { ...native.artifact, nativeManifestVersion: "2", schema: native.schema, proof: native.proof },
      ...identity.core, custody, sensitive: true, verifiedAt: now() };
    await stepAsync(() => deps.store.seal(manifest), (error) => errorMessage(error) === "HINDSIGHT_BACKUP_ARTIFACT_INVALID"
      ? "HINDSIGHT_BACKUP_INTERNAL_ERROR" : "HINDSIGHT_BACKUP_STORAGE_FAILED");
    return manifest;
  } catch (error) {
    // An unpaired Core copy is never offered as a backup; the partial dir goes with the failure.
    await deps.store.discard(capture.backupId).catch(() => deps.logger.warn({ code: "HINDSIGHT_BACKUP_STORAGE_FAILED" }, "partial backup dir was not removed"));
    throw error;
  }
}

async function nativeSnapshot(deps: HindsightBackupServiceInput, input: {
  capture: HindsightBackupCaptureInput; identity: HindsightBackupIdentity; signal: AbortSignal;
}): Promise<HindsightNativeBackupSnapshot> {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(deps.nativeTimeoutMs ?? NATIVE_TIMEOUT_MS)]);
  // The fence stays closed until this settles, so a route that ignores its signal must not hold writes past the deadline.
  const snapshot = await stepAsync(() => Promise.race([deps.route.snapshot({ backupId: input.capture.backupId,
    providerLineageId: input.identity.core.authority.providerLineageId, nativeBankIds: input.identity.core.banks.map((bank) => bank.nativeBankId),
    operationIds: input.identity.operationIds, signal }), aborted(signal)]), () => "HINDSIGHT_BACKUP_NATIVE_FAILED");
  const proof = HindsightBackupNativeProofSchema.safeParse(snapshot.proof);
  if (!proof.success) throw new CaptureFailure("HINDSIGHT_BACKUP_NATIVE_FAILED");
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

function step<T>(action: () => T, code: (error: unknown) => MemoryBackupErrorCode): T {
  try { return action(); }
  catch (error) { throw error instanceof CaptureFailure ? error : new CaptureFailure(code(error)); }
}

async function stepAsync<T>(action: () => Promise<T>, code: (error: unknown) => MemoryBackupErrorCode): Promise<T> {
  try { return await action(); }
  catch (error) { throw error instanceof CaptureFailure ? error : new CaptureFailure(code(error)); }
}

function failed(code: MemoryBackupErrorCode, mismatch: HindsightBackupPairMismatch | null = null): HindsightBackupCaptureOutcome {
  return { ok: false, code, mismatch };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}
