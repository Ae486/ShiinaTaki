/**
 * INPUT:  the pure Hindsight binding snapshot, the live Hindsight connection config and the committed authority marker
 * OUTPUT: hindsightUnboundReason() (the known configuration cause of an unbound selected runtime, or null) and
 *         createUnboundHindsightCapture() -> the memory-unavailable Run for that cause, or MEMORY_RUNTIME_UNAVAILABLE
 * POS:    core/memory — composition-side degrade for a Hindsight runtime a setting kept unbound; every other unbound state
 *         (unknown construct/start failure, epoch mismatch, stopped) keeps refusing; never a Local or Legacy fallback
 */
import type { Logger } from "../logging/logger.ts";
import type { Database } from "../db/sqlite.ts";
import type { CapturedMemoryRun } from "./canonical-memory-run.ts";
import type { HindsightBindingSnapshot } from "./hindsight-runtime-binding.ts";
import type { HindsightLiveConnection } from "./hindsight/hindsight-runtime-connection.ts";
import { createHindsightUnavailableRun } from "./hindsight/hindsight-unavailable-run.ts";
import { readMemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";
import { createFallbackPersonaProvider, createPersonaProvider } from "./persona-provider.ts";

export type HindsightUnboundReason = "connection_disabled" | "config_changed";

/** Pure: only a disabled/unconfigured connection or a template-revision conflict is a known configuration cause. */
export function hindsightUnboundReason(snapshot: HindsightBindingSnapshot, live: HindsightLiveConnection | null): HindsightUnboundReason | null {
  const { binding } = snapshot;
  if (snapshot.selection !== "hindsight" || snapshot.lifetime !== "running" || binding.kind !== "unavailable"
    || binding.epochId !== snapshot.selectedEpochId) return null;
  if (live && live.state !== "ready") return "connection_disabled";
  return binding.code === "HINDSIGHT_TEMPLATE_CONFLICT" ? "config_changed" : null;
}

export function createUnboundHindsightCapture(input: {
  db: Database; logger: Logger; promptDir?: string; binding(): HindsightBindingSnapshot; live(): HindsightLiveConnection | null;
}): (characterId: string) => CapturedMemoryRun {
  const persona = input.promptDir ? createPersonaProvider({ promptDir: input.promptDir }) : createFallbackPersonaProvider();
  return (characterId) => {
    const reason = hindsightUnboundReason(input.binding(), readLive(input.live));
    if (!reason) throw new Error("MEMORY_RUNTIME_UNAVAILABLE");
    // The marker read re-verifies the committed receipt, so the Run carries the proven epoch/lineage identity.
    const selection = readMemoryAuthoritySelection(input.db);
    if (selection.mode !== "hindsight" || !selection.epochId || !selection.providerLineageId) throw new Error("MEMORY_RUNTIME_UNAVAILABLE");
    input.logger.warn({ characterId, code: reason }, "Hindsight Run admitted without memory");
    return createHindsightUnavailableRun({ epoch: { epochId: selection.epochId, providerLineageId: selection.providerLineageId },
      characterId, persona });
  };
}

// An unreadable live config is not a known setting: fail closed to the binding code alone.
function readLive(live: () => HindsightLiveConnection | null): HindsightLiveConnection | null {
  try { return live(); } catch { return null; }
}
