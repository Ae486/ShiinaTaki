/**
 * INPUT:  unknown errors raised by Hindsight setup dependencies
 * OUTPUT: bounded HindsightError normalization shared by setup stages
 * POS:    core/memory/hindsight — sanitized error boundary; provider details never escape
 */
import { HindsightError, hindsightError } from "./hindsight-errors.ts";

export function normalizeError(error: unknown): HindsightError {
  return error instanceof HindsightError ? error : hindsightError("HINDSIGHT_RESPONSE_INVALID");
}
