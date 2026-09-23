/**
 * INPUT:  any error raised by the drain, the D78 primitives, the native client or the promotion transaction
 * OUTPUT: hindsightActivationErrorCode() — the closed MemoryHindsightActivationErrorCode; activationFailure() wraps the cause
 * POS:    core/memory/hindsight-activation — sanitization boundary; unknown causes become HINDSIGHT_ACTIVATION_INTERNAL_ERROR, never text
 */
import { MemoryHindsightActivationErrorCodeSchema, type MemoryHindsightActivationErrorCode } from "@taki/shared";

const CODES: ReadonlySet<string> = new Set(MemoryHindsightActivationErrorCodeSchema.options);
const ALIASES: Record<string, MemoryHindsightActivationErrorCode> = {
  LEASE_LOST: "HINDSIGHT_CUTOVER_LEASE_LOST",
  HINDSIGHT_LOCAL_COVERAGE_SELECTION_STALE: "HINDSIGHT_LOCAL_COVERAGE_STALE",
  HINDSIGHT_LOCAL_COVERAGE_RUN_MISMATCH: "HINDSIGHT_PREDECESSOR_STALE",
  HINDSIGHT_CURRENT_NATIVE_STATE_INVALIDATED: "HINDSIGHT_CURRENT_NATIVE_REFUSED",
  MEMORY_INGESTION_FAILED: "MEMORY_INGESTION_INCOMPLETE",
  MEMORY_INGESTION_BASELINE_MISSING: "MEMORY_INGESTION_INCOMPLETE",
  MEMORY_INGESTION_SOURCE_UNPROVEN: "MEMORY_INGESTION_INCOMPLETE",
  MEMORY_INGESTION_SOURCE_TOO_LARGE: "MEMORY_INGESTION_INCOMPLETE",
};

export function hindsightActivationErrorCode(error: unknown): MemoryHindsightActivationErrorCode {
  const head = (error instanceof Error ? error.message : "").split(":")[0] ?? "";
  if (CODES.has(head)) return head as MemoryHindsightActivationErrorCode;
  return ALIASES[head] ?? "HINDSIGHT_ACTIVATION_INTERNAL_ERROR";
}

/** The thrown message is exactly the closed code; the original cause stays attached for in-process diagnostics only. */
export function activationFailure(error: unknown): Error {
  const code = hindsightActivationErrorCode(error);
  return error instanceof Error && error.message === code ? error : new Error(code, { cause: error });
}
