/**
 * INPUT:  native HTTP failure bodies on ordinary and transition routes
 * OUTPUT: closed fence/stale-executor errors before legacy cursor-reset handling
 * POS:    Core provider transport — a durable write fence never authorizes replica rebuild
 */
import { hindsightError, type HindsightError } from "./hindsight-errors.ts";

export function hindsightTransitionPublicationFailure(status: number, body: string): HindsightError | null {
  if (status !== 409 || body.length > 16_384) return null;
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object") return null;
    const reason = "error" in value && value.error === "taki_transition_refused" && "reason" in value ? value.reason
      : "detail" in value ? value.detail : null;
    if (reason === "bank_fenced" || reason === "taki_transition_fenced") return hindsightError("HINDSIGHT_TRANSITION_FENCED");
    if (reason === "writer_stale" || reason === "taki_transition_writer_stale") return hindsightError("HINDSIGHT_TRANSITION_EXECUTOR_LOST");
  } catch { /* Unknown old envelopes retain their existing endpoint handling. */ }
  return null;
}
