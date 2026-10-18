/**
 * INPUT:  a staged route-b capture (`<id>.staged/`: Core copy, Core identity, native request), the operator's native ZIP named
 *         by a plain inbox file name, the expected epoch and a phase checkpoint
 * OUTPUT: admitHindsightBackup() -> claims the ZIP into the staged dir, reads its in-ZIP proof, requires the echoed backup id,
 *         runs the pair check against the staged Core identity and seals the pair verified; any refusal returns the ZIP to
 *         the inbox and leaves the staged capture for a corrected ZIP
 * POS:    core/memory/hindsight-backup — backup.admit producer (route b, PR02 fallback); never contacts native, never pauses
 *         writes: the Core copy was taken under the fence at capture, the ZIP must prove it is not older than that copy
 */
import type { MemoryBackupProducerRef } from "@taki/shared";
import type { Logger } from "../../logging/logger.ts";
import { readHindsightBackupArchive } from "./hindsight-backup-archive.ts";
import {
  codeOf, errorMessage, failedOutcome, HindsightBackupFailure, outcomeOf, step, stepAsync, type HindsightBackupOutcome,
} from "./hindsight-backup-failure.ts";
import { verifyHindsightBackupPair } from "./hindsight-backup-pair.ts";
import type { HindsightBackupStagedRecord, HindsightBackupStore } from "./hindsight-backup-store.ts";
import { readHindsightBackupCopy } from "./hindsight-backup-copy-readback.ts";
import { createHindsightSealedManifest } from "./hindsight-backup-manifest.ts";

export interface HindsightBackupAdmitInput {
  backupId: string; fileName: string; expectedEpochId: string;
  signal?: AbortSignal;
  checkpoint(phase: MemoryBackupProducerRef["phase"]): void;
}
interface AdmitDeps { store: HindsightBackupStore; logger: Logger; now: () => string }

export async function admitHindsightBackup(deps: AdmitDeps, input: HindsightBackupAdmitInput): Promise<HindsightBackupOutcome> {
  input.checkpoint("verifying");
  try {
    const staged = await stepAsync(() => deps.store.readStaged(input.backupId), (error) => codeOf(error, "HINDSIGHT_BACKUP_STORAGE_FAILED"));
    input.signal?.throwIfAborted();
    // Only a Core copy this host staged can be paired; an unknown id has no Core half to prove anything against.
    if (!staged) return failedOutcome("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
    if (staged.core.authority.epochId !== input.expectedEpochId) return failedOutcome("MEMORY_AUTHORITY_MISMATCH");
    if (staged.core.version === 2) step(() => readHindsightBackupCopy(deps.store.corePath(input.backupId, "staged"), staged.core, staged.request),
      (error) => codeOf(error, "HINDSIGHT_BACKUP_ARTIFACT_INVALID"));
    const path = await stepAsync(() => deps.store.claimInbox(input.backupId, input.fileName),
      (error) => codeOf(error, "HINDSIGHT_BACKUP_STORAGE_FAILED"));
    try { return await sealClaimed(deps, { input, staged, path }); }
    catch (error) {
      returnInbox(deps, input);
      throw error;
    }
  } catch (error) {
    return outcomeOf(error, (unexpected) => deps.logger.error({ code: "HINDSIGHT_BACKUP_INTERNAL_ERROR",
      err: unexpected instanceof Error ? unexpected.name : "unknown" }, "backup admit failed"));
  }
}

async function sealClaimed(deps: AdmitDeps, claimed: { input: HindsightBackupAdmitInput; staged: HindsightBackupStagedRecord; path: string }): Promise<HindsightBackupOutcome> {
  const { input, staged } = claimed;
  const archive = await stepAsync(() => readHindsightBackupArchive(claimed.path), (error) => codeOf(error, "HINDSIGHT_BACKUP_ARTIFACT_INVALID"));
  input.signal?.throwIfAborted();
  // The echoed id binds the ZIP to this staged request; a ZIP made before the request existed cannot carry it.
  if (archive.backupId !== input.backupId || archive.version !== staged.request.version) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
  const pair = verifyHindsightBackupPair(staged.core, archive.proof);
  if (!pair.ok) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_PAIR_MISMATCH", { reason: pair.reason, bankId: pair.bankId });
  input.checkpoint("sealing");
  const manifest = createHindsightSealedManifest(staged.core, { route: "operator-artifact", native: { location: "core-dir", file: "native.zip" },
    schema: archive.schema, proof: archive.proof, verifiedAt: deps.now() });
  await stepAsync(() => deps.store.sealStaged(manifest), (error) => errorMessage(error) === "HINDSIGHT_BACKUP_ARTIFACT_INVALID"
    ? "HINDSIGHT_BACKUP_INTERNAL_ERROR" : "HINDSIGHT_BACKUP_STORAGE_FAILED");
  return { ok: true, verifiedAt: manifest.verifiedAt };
}

function returnInbox(deps: AdmitDeps, input: HindsightBackupAdmitInput): void {
  let returned: boolean;
  try { returned = deps.store.returnInbox(input.backupId, input.fileName); }
  catch { returned = false; }
  if (!returned) deps.logger.warn({ code: "HINDSIGHT_BACKUP_STORAGE_FAILED" }, "refused native ZIP stays in the staged backup dir");
}
