/**
 * INPUT:  a Run's routed Banks, the caller's cancellation, the connection's per-request timeout and the admission budget
 * OUTPUT: synchronizeHindsightCapture() -> "synced" | "partial" | "admission_unavailable" | the connection drift seen after an
 *         incomplete sync, plus one closed-code event per Bank that was refused, degraded, deferred past the budget or failed
 *         later in the background
 * POS:    core/memory/hindsight — Run-admission foreground sync bounded by the composed admission budget; unfinished Bank work stays
 *         owned by the Bank service; only integrity, authority and cancellation failures refuse the Run
 */
import type { MemoryReplicaBank } from "@taki/shared";
import type { HindsightCallContext } from "./hindsight-client.ts";
import { hindsightMemoryErrorCode } from "./hindsight-memory-provider-context.ts";
import type { HindsightConnectionDrift } from "./hindsight-runtime-connection.ts";
import type { HindsightRuntimeState } from "./hindsight-runtime-state.ts";

export type HindsightCaptureSync = "synced" | "partial" | "admission_unavailable" | Exclude<HindsightConnectionDrift, "none">;
export interface HindsightCaptureSyncEvent {
  characterId: string; bankId: string; code: string; outcome: "refused" | "degraded" | "deferred" | "background_failed";
}
interface Input {
  characterId: string; banks: readonly MemoryReplicaBank[]; signal?: AbortSignal; budgetMs: number;
  onEvent?: (event: HindsightCaptureSyncEvent) => void;
}
/** undefined: still running (or queued behind an unfinished Bank) when the budget expired. */
type Outcome = "synced" | { error: unknown } | undefined;
interface SyncRun { outcomes: Outcome[]; detached: boolean; context: HindsightCallContext }

const REFUSED = new Set(["MEMORY_INTEGRITY_ERROR", "MEMORY_AUTHORITY_MISMATCH", "MEMORY_REQUEST_ID_CONFLICT"]);

export async function synchronizeHindsightCapture(state: HindsightRuntimeState, input: Input): Promise<HindsightCaptureSync> {
  if (input.signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
  const timeoutMs = state.runtime.connection.requestTimeoutMs;
  // The caller may cancel only within its budget. Afterwards the Bank service owns the sync until it completes or
  // Core stops, so binding progress is never abandoned and a later sync reuses its durable receipts.
  const owner = new AbortController(); const forward = () => owner.abort();
  input.signal?.addEventListener("abort", forward, { once: true });
  const run: SyncRun = { outcomes: input.banks.map(() => undefined), detached: false, context: { timeoutMs, signal: owner.signal } };
  try { await within(syncBanks(state, input, run), input.budgetMs); }
  finally { run.detached = true; input.signal?.removeEventListener("abort", forward); }
  if (input.signal?.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
  // A connection changed or disabled mid-sync fails the sync guards as an authority mismatch; like a drift seen before
  // the sync, it degrades this Run to memory-unavailable instead of refusing the chat turn.
  const drift = run.outcomes.every((outcome) => outcome === "synced") ? "none" : connectionDrift(state);
  if (drift !== "none") return drift;
  const partial = settle(input, run.outcomes);
  // A readable replica does not prove negotiated capabilities. Missing evidence
  // must not start an implicit coordinator admission without this caller's signal;
  // an unfinished or failed sync degrades this Run instead of refusing the chat turn.
  if (state.provider.capabilitiesSnapshot()) return partial ? "partial" : "synced";
  if (partial) return "admission_unavailable";
  throw new Error("HINDSIGHT_APPLICATION_ADMISSION_UNAVAILABLE");
}

async function syncBanks(state: HindsightRuntimeState, input: Input, run: SyncRun): Promise<void> {
  for (const [index, bank] of input.banks.entries()) {
    try {
      await state.service.synchronize({ bankId: bank.bankId, mode: "foreground", context: run.context });
      run.outcomes[index] = "synced";
    } catch (error) {
      run.outcomes[index] = { error };
      if (cancelled(error)) return;
      if (run.detached) report(input, { bankId: bank.bankId, code: closedCode(error), outcome: "background_failed" });
      if (refused(error)) return;
    }
  }
}

/** Reports every unsynced Bank and returns whether the Run is partial; a cancellation or integrity failure refuses it. */
function settle(input: Input, outcomes: readonly Outcome[]): boolean {
  let partial = false;
  for (const [index, bank] of input.banks.entries()) {
    const outcome = outcomes[index];
    if (outcome === "synced") continue;
    partial = true;
    if (outcome === undefined) { report(input, { bankId: bank.bankId, code: "HINDSIGHT_DEADLINE_EXCEEDED", outcome: "deferred" }); continue; }
    if (cancelled(outcome.error)) throw outcome.error;
    report(input, { bankId: bank.bankId, code: closedCode(outcome.error), outcome: refused(outcome.error) ? "refused" : "degraded" });
    if (refused(outcome.error)) throw outcome.error;
  }
  return partial;
}

function within(work: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/** An epoch/lineage change (or a stopped runtime) throws here; it stays the original failure's refusal. */
function connectionDrift(state: HindsightRuntimeState): HindsightConnectionDrift {
  try { return state.runtime.driftReason(); } catch { return "none"; }
}

function cancelled(error: unknown): boolean { return hindsightMemoryErrorCode(error) === "MEMORY_OPERATION_CANCELLED"; }
function refused(error: unknown): boolean { return REFUSED.has(hindsightMemoryErrorCode(error)); }

function report(input: Input, event: Omit<HindsightCaptureSyncEvent, "characterId">): void {
  input.onEvent?.({ characterId: input.characterId, ...event });
}

/** Provider and validation messages may carry content; only a closed CONSTANT_CASE code reaches diagnostics. */
function closedCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "MEMORY_INTERNAL_ERROR";
}
