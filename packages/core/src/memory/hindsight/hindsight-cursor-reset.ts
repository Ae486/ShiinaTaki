/**
 * INPUT:  the bounded body of a native 409 on the replication `/changes` or `/snapshots` routes, and the Core checkpoint
 * OUTPUT: hindsightCursorResetFailure(body) -> HINDSIGHT_CURSOR_RESET_REQUIRED, or HindsightRollbackError when native reports
 *         `cursor_ahead`; confirmHindsightRollback() keeps it only for the checkpoint's own lineage and generation
 * POS:    core/memory/hindsight — §5.7 rollback detection; only closed fields are read, the body is never logged or echoed
 */
import { z } from "zod";
import { HINDSIGHT_DEFAULT_RESPONSE_BYTES } from "./hindsight-http-transport.ts";
import { HindsightError, hindsightError } from "./hindsight-errors.ts";

const CursorResetWireSchema = z.object({
  error: z.literal("replication_cursor_reset_required"), reason: z.enum(["cursor_expired", "cursor_ahead"]),
  provider_lineage: z.uuid(), bank_generation: z.uuid(),
});

/** Native is behind Core's cursor: a restore that did not include Core's copy, never a replica to rebuild. */
export class HindsightRollbackError extends HindsightError {
  readonly providerLineageId: string;
  readonly bankGeneration: string;
  constructor(identity: { providerLineageId: string; bankGeneration: string }) {
    super(hindsightError("HINDSIGHT_PROVIDER_ROLLBACK_DETECTED").projection());
    this.providerLineageId = identity.providerLineageId; this.bankGeneration = identity.bankGeneration;
  }
}

/** Anything but a well-formed `cursor_ahead` keeps the rebuild path, including an unparseable or oversized body. */
export function hindsightCursorResetFailure(body: string): HindsightError {
  const reset = hindsightError("HINDSIGHT_CURSOR_RESET_REQUIRED");
  if (new TextEncoder().encode(body).byteLength > HINDSIGHT_DEFAULT_RESPONSE_BYTES) return reset;
  let parsed: ReturnType<typeof CursorResetWireSchema.safeParse>;
  try { parsed = CursorResetWireSchema.safeParse(JSON.parse(body)); } catch { return reset; }
  if (!parsed.success || parsed.data.reason !== "cursor_ahead") return reset;
  return new HindsightRollbackError({ providerLineageId: parsed.data.provider_lineage, bankGeneration: parsed.data.bank_generation });
}

/** A changed lineage or generation is a different Bank history, which the existing reset already rebuilds. */
export function confirmHindsightRollback(error: unknown, expected: { providerLineageId: string; bankGeneration: string }): unknown {
  if (!(error instanceof HindsightRollbackError)) return error;
  const same = error.providerLineageId === expected.providerLineageId && error.bankGeneration === expected.bankGeneration;
  return same ? error : hindsightError("HINDSIGHT_CURSOR_RESET_REQUIRED");
}
