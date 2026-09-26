/**
 * INPUT:  a sealed backup id, the artifact store, the current catalog's credential read-back and a phase checkpoint
 * OUTPUT: verifyHindsightBackup() -> re-hashes core.sqlite and a Core-held native.zip against the manifest, re-reads a route-b
 *         ZIP's in-ZIP proof, re-runs the pair check, then names any credential the record saw present and this host lacks;
 *         a verified pair rewrites only `verifiedAt` (atomic replace), a broken artifact or pair records `verifiedAt: null`
 * POS:    core/memory/hindsight-backup — backup.verify producer; local only (a native-host ZIP is judged by its recorded
 *         proof, never fetched); a missing credential is host state, so it fails the run without touching the manifest
 */
import { isDeepStrictEqual } from "node:util";
import type { HindsightBackupManifest, HindsightBackupNativeProof, MemoryBackupErrorCode, MemoryBackupProducerRef } from "@taki/shared";
import type { Logger } from "../../logging/logger.ts";
import { readHindsightBackupArchive } from "./hindsight-backup-archive.ts";
import {
  codeOf, failedOutcome, HindsightBackupFailure, outcomeOf, stepAsync, type HindsightBackupOutcome,
} from "./hindsight-backup-failure.ts";
import { errorCode, type HindsightBackupFileDigest } from "./hindsight-backup-files.ts";
import { verifyHindsightBackupPair } from "./hindsight-backup-pair.ts";
import type { HindsightBackupFile, HindsightBackupStore } from "./hindsight-backup-store.ts";

export interface HindsightBackupVerifyInput {
  backupId: string;
  checkpoint(phase: MemoryBackupProducerRef["phase"]): void;
}
interface VerifyDeps {
  store: HindsightBackupStore; logger: Logger; now: () => string;
  missingCredentials(custody: HindsightBackupManifest["custody"]): string[];
}

/** Codes that describe the artifact itself; only these clear a recorded verification. */
const ARTIFACT_CODES: readonly MemoryBackupErrorCode[] = ["HINDSIGHT_BACKUP_ARTIFACT_INVALID", "HINDSIGHT_BACKUP_PROOF_MISSING", "HINDSIGHT_BACKUP_PAIR_MISMATCH"];

export async function verifyHindsightBackup(deps: VerifyDeps, input: HindsightBackupVerifyInput): Promise<HindsightBackupOutcome> {
  input.checkpoint("verifying");
  const unexpected = (error: unknown) => deps.logger.error({ code: "HINDSIGHT_BACKUP_INTERNAL_ERROR",
    err: error instanceof Error ? error.name : "unknown" }, "backup verify failed");
  try {
    const manifest = await stepAsync(() => deps.store.read(input.backupId), (error) => codeOf(error, "HINDSIGHT_BACKUP_STORAGE_FAILED"));
    if (!manifest) return failedOutcome("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
    const judged = await judge(deps.store, manifest).then(() => null, (error: unknown) => outcomeOf(error, unexpected));
    if (judged && !judged.ok && ARTIFACT_CODES.includes(judged.code)) {
      await record(deps.store, { manifest, verifiedAt: null });
      return judged;
    }
    if (judged) return judged;
    const missing = deps.missingCredentials(manifest.custody);
    if (missing.length > 0) {
      deps.logger.warn({ code: "HINDSIGHT_BACKUP_CREDENTIAL_MISSING", refs: missing }, "backup custody names credentials this host lacks");
      return failedOutcome("HINDSIGHT_BACKUP_CREDENTIAL_MISSING");
    }
    input.checkpoint("sealing");
    return { ok: true, verifiedAt: (await record(deps.store, { manifest, verifiedAt: deps.now() })).verifiedAt };
  } catch (error) {
    return outcomeOf(error, unexpected);
  }
}

async function judge(store: HindsightBackupStore, manifest: HindsightBackupManifest): Promise<void> {
  assertDigest(await digest(store, { manifest, file: "core.sqlite" }), manifest.core);
  const proof = await nativeProof(store, manifest);
  const pair = verifyHindsightBackupPair(manifest, proof);
  if (!pair.ok) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_PAIR_MISMATCH", { reason: pair.reason, bankId: pair.bankId });
}

/** The proof the pair check judges: re-read from a Core-held route-b ZIP, else the recorded one after its bytes re-hash. */
async function nativeProof(store: HindsightBackupStore, manifest: HindsightBackupManifest): Promise<HindsightBackupNativeProof> {
  const recorded = manifest.native.proof;
  if (manifest.native.location !== "core-dir") return recorded;
  if (manifest.route === "native-endpoint") {
    assertDigest(await digest(store, { manifest, file: "native.zip" }), { sha256: recorded.zipSha256, bytes: recorded.zipBytes });
    return recorded;
  }
  const archive = await stepAsync(() => readHindsightBackupArchive(store.nativePath(manifest.backupId)),
    (error) => codeOf(error, "HINDSIGHT_BACKUP_ARTIFACT_INVALID"));
  if (archive.backupId !== manifest.backupId || !isDeepStrictEqual(archive.proof, recorded)) {
    throw new HindsightBackupFailure("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
  }
  return archive.proof;
}

function digest(store: HindsightBackupStore, input: { manifest: HindsightBackupManifest; file: HindsightBackupFile }): Promise<HindsightBackupFileDigest> {
  return stepAsync(() => store.digest(input.manifest.backupId, input.file),
    (error) => errorCode(error) === "ENOENT" ? "HINDSIGHT_BACKUP_ARTIFACT_INVALID" : "HINDSIGHT_BACKUP_STORAGE_FAILED");
}

function assertDigest(actual: HindsightBackupFileDigest, expected: HindsightBackupFileDigest): void {
  if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) throw new HindsightBackupFailure("HINDSIGHT_BACKUP_ARTIFACT_INVALID");
}

function record(store: HindsightBackupStore, input: { manifest: HindsightBackupManifest; verifiedAt: string | null }): Promise<HindsightBackupManifest> {
  return stepAsync(() => store.markVerified(input.manifest.backupId, input.verifiedAt), () => "HINDSIGHT_BACKUP_STORAGE_FAILED");
}
