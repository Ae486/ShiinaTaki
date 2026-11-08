/**
 * INPUT:  a closed candidate reason/subject, or a coded backup error escaping a reused Stage 3 reader
 * OUTPUT: HindsightCandidateRefused carrying the strict Shared refusal; refuse() and refusalOf() mapping helpers
 * POS:    core/memory/hindsight-candidates — the one refusal vocabulary of admission and verification; no fs or logging
 */
import { HindsightCandidateRefusalSchema, MemoryBackupErrorCodeSchema, type HindsightCandidateRefusal,
  type HindsightCandidateRefusalReason, type HindsightCandidateSubject, type MemoryBackupErrorCode } from "@taki/shared";
import { HindsightBackupFailure } from "../hindsight-backup/hindsight-backup-failure.ts";

export class HindsightCandidateRefused extends Error {
  readonly refusal: HindsightCandidateRefusal;
  constructor(refusal: HindsightCandidateRefusal) {
    super(`HINDSIGHT_CANDIDATE_${refusal.reason.toUpperCase()}`); this.name = "HindsightCandidateRefused";
    this.refusal = HindsightCandidateRefusalSchema.parse(refusal);
  }
}

export function refuse(reason: HindsightCandidateRefusalReason, subject: HindsightCandidateSubject,
  detail: { name?: string; code?: MemoryBackupErrorCode } = {}): never {
  throw new HindsightCandidateRefused({ reason, subject, name: detail.name ?? null, code: detail.code ?? null });
}

/** Stage 3 readers keep their own closed codes; each maps to one candidate distinction and is retained as `code`. */
const BACKUP_CODE_REFUSALS: Partial<Record<MemoryBackupErrorCode, [HindsightCandidateRefusalReason, HindsightCandidateSubject]>> = {
  HINDSIGHT_BACKUP_ARTIFACT_INVALID: ["tampered", "core"],
  HINDSIGHT_BACKUP_READBACK_MISMATCH: ["tampered", "core"],
  HINDSIGHT_BACKUP_PAIR_MISMATCH: ["tampered", "manifest"],
  HINDSIGHT_BACKUP_NATIVE_INCOMPATIBLE: ["unsupported", "schema"],
  HINDSIGHT_BACKUP_CREDENTIAL_MISSING: ["absent", "credential"],
  HINDSIGHT_BACKUP_TEMPLATE_OBSERVATION_REQUIRED: ["unsupported", "template"],
  HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN: ["tampered", "template"],
  HINDSIGHT_BACKUP_TEMPLATE_UNPUBLISHED: ["tampered", "template"],
};

/** A refusal passes through; a coded backup error keeps its code; anything else is the caller's fallback distinction. */
export function refusalOf(error: unknown, fallback: [HindsightCandidateRefusalReason, HindsightCandidateSubject]): HindsightCandidateRefused {
  if (error instanceof HindsightCandidateRefused) return error;
  const parsed = MemoryBackupErrorCodeSchema.safeParse(error instanceof HindsightBackupFailure ? error.code
    : error instanceof Error ? error.message : undefined);
  const code = parsed.success ? parsed.data : undefined;
  const [reason, subject] = (code && BACKUP_CODE_REFUSALS[code]) ?? fallback;
  const template = error instanceof HindsightBackupFailure && error.mismatch?.reason.startsWith("template_");
  return new HindsightCandidateRefused({ reason, subject: template ? "template" : subject, name: null, code: code ?? null });
}
