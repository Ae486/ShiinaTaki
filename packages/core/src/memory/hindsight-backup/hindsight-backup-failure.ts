/**
 * INPUT:  errors thrown by backup steps (coded Error messages, HindsightBackupFailure, anything unexpected)
 * OUTPUT: HindsightBackupOutcome, HindsightBackupFailure, step()/stepAsync() that name an escaping error by its step's closed
 *         code, failedOutcome()/outcomeOf() and codeOf() for coded messages
 * POS:    core/memory/hindsight-backup — the one failure vocabulary shared by capture, admit and verify; no fs, no logging
 */
import {
  MemoryBackupErrorCodeSchema, type HindsightBackupPairMismatch, type MemoryBackupErrorCode,
} from "@taki/shared";

export type HindsightBackupOutcome =
  | { ok: true; verifiedAt: string | null }
  | { ok: false; code: MemoryBackupErrorCode; mismatch: HindsightBackupPairMismatch | null };

/** A failure already named by its step; anything else escaping a step is classified by the step's mapper. */
export class HindsightBackupFailure extends Error {
  readonly code: MemoryBackupErrorCode;
  readonly mismatch: HindsightBackupPairMismatch | null;
  constructor(code: MemoryBackupErrorCode, mismatch: HindsightBackupPairMismatch | null = null) {
    super(code); this.name = "HindsightBackupFailure"; this.code = code; this.mismatch = mismatch;
  }
}

export function step<T>(action: () => T, code: (error: unknown) => MemoryBackupErrorCode): T {
  try { return action(); }
  catch (error) { throw error instanceof HindsightBackupFailure ? error : new HindsightBackupFailure(code(error)); }
}

export async function stepAsync<T>(action: () => Promise<T>, code: (error: unknown) => MemoryBackupErrorCode): Promise<T> {
  try { return await action(); }
  catch (error) { throw error instanceof HindsightBackupFailure ? error : new HindsightBackupFailure(code(error)); }
}

export function failedOutcome(code: MemoryBackupErrorCode, mismatch: HindsightBackupPairMismatch | null = null): HindsightBackupOutcome {
  return { ok: false, code, mismatch };
}

/** The outcome a failed step named; anything else is INTERNAL_ERROR, reported once through `unexpected`. */
export function outcomeOf(error: unknown, unexpected: (error: unknown) => void): HindsightBackupOutcome {
  if (error instanceof HindsightBackupFailure) return failedOutcome(error.code, error.mismatch);
  unexpected(error);
  return failedOutcome("HINDSIGHT_BACKUP_INTERNAL_ERROR");
}

/** The closed code a coded Error carries, else the fallback. */
export function codeOf(error: unknown, fallback: MemoryBackupErrorCode): MemoryBackupErrorCode {
  const code = MemoryBackupErrorCodeSchema.safeParse(errorMessage(error));
  return code.success ? code.data : fallback;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}
