/**
 * INPUT:  current authority evidence and the composed runtime's detached binding publication metadata
 * OUTPUT: fresh operator selection/bindings and one atomic read-only Hindsight runtime projection
 * POS:    core/memory/operations — owns no authority verdict; runtime guards have separate verification owners
 */
import type { MemoryAuthorityStatus, MemoryRuntimeUnavailableReason } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { activeTemplateHold } from "../hindsight/template-lifecycle/template-execution-reads.ts";
import { hindsightRuntimeAvailability, type HindsightBindingSnapshot } from "../hindsight-runtime-binding.ts";
import type { HindsightConnectionDrift } from "../hindsight/hindsight-runtime-connection.ts";
import { readCurrentMemoryAuthorityIdentity, type MemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { LocalBindingSnapshot } from "../local-runtime-binding.ts";
import { localRuntimeAvailability } from "../local-onboarding/local-onboarding-reads.ts";
import type { composeMemoryRuntime } from "../runtime-composition.ts";

interface MemoryStatusObservation {
  selection: MemoryAuthoritySelection;
  localBinding: LocalBindingSnapshot;
  hindsightBinding: HindsightBindingSnapshot;
}

export interface MemoryRuntimeStatusObservation extends MemoryStatusObservation {
  runtime: Pick<MemoryAuthorityStatus, "replica" | "pending"> & {
    present: boolean;
    drift: HindsightConnectionDrift | null;
    unavailableReason: MemoryRuntimeUnavailableReason | null;
  };
  boundSelectionIdentity: string | null;
}
type RuntimeStatusSource = Pick<ReturnType<typeof composeMemoryRuntime>, "bindingPublication" | "hasPublishedBinding" | "observeHindsightStatus">;

export function createMemoryStatusObserver(input: {
  db: Database; runtime: RuntimeStatusSource;
}) {
  let closed = false;
  const read = (): MemoryStatusObservation => {
    if (closed) throw new Error("MEMORY_OPERATION_CANCELLED");
    const local = input.runtime.bindingPublication("local");
    const hindsight = input.runtime.bindingPublication("hindsight");
    const selection = readCurrentMemoryAuthorityIdentity(input.db);
    const invalid = hindsight.binding.kind === "unavailable" && hindsight.binding.code === "MEMORY_AUTHORITY_INVALID";
    const held = !invalid && selection.mode === "hindsight" && selection.epochId ? activeTemplateHold(input.db, selection.epochId) : null;
    const selected = { selection: selection.mode, selectedEpochId: selection.epochId };
    return { selection,
      localBinding: { ...selected, binding: local.binding, lifetime: local.lifetime,
        flush: local.binding.kind === "published" && local.lifetime === "running" ? "available" : "failing" },
      hindsightBinding: { ...selected, lifetime: hindsight.lifetime,
        binding: held ? { kind: "unavailable", epochId: held.epochId, code: "MEMORY_TEMPLATE_HOLD" } : hindsight.binding,
        flush: hindsight.binding.kind === "published" && hindsight.lifetime === "running" && !held ? "available" : "failing" } };
  };
  const readRuntime = (): MemoryRuntimeStatusObservation => {
    let result: MemoryRuntimeStatusObservation | undefined;
    input.db.transaction(() => {
      result = readRuntimeObservation(input.runtime, read());
    });
    if (!result) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    return result;
  };
  return { read, readRuntime, close: () => { closed = true; } };
}

function readRuntimeObservation(source: RuntimeStatusSource, view: MemoryStatusObservation): MemoryRuntimeStatusObservation {
  const hindsight = view.selection.mode === "hindsight";
  const present = hindsight && source.hasPublishedBinding("hindsight");
  const runtime: MemoryRuntimeStatusObservation["runtime"] = { present, drift: null, replica: null, pending: null,
    unavailableReason: hindsight ? hindsightRuntimeAvailability(view.hindsightBinding).unavailableReason
      : view.selection.mode === "canonical-local" ? localRuntimeAvailability(view.localBinding).unavailableReason : null };
  let boundSelectionIdentity: string | null = null;
  if (hindsight && runtime.unavailableReason === null) {
    try {
      const observed = present ? source.observeHindsightStatus() : null;
      if (!observed) runtime.unavailableReason = "not_installed";
      else {
        runtime.drift = observed.drift;
        if (observed.drift === "none") {
          boundSelectionIdentity = observed.templateSelectionIdentity;
          if ("error" in observed.evidence) {
            runtime.unavailableReason = "evidence_invalid";
          } else { runtime.replica = observed.evidence.replica; runtime.pending = observed.evidence.pending; }
        } else runtime.unavailableReason = observed.drift;
      }
    } catch (error) { runtime.unavailableReason = memoryStatusUnavailableReason(error); }
  }
  return { ...view, runtime, boundSelectionIdentity };
}

export function memoryStatusUnavailableReason(error: unknown): MemoryRuntimeUnavailableReason {
  const message = error instanceof Error ? error.message : "";
  if (message === "MEMORY_OPERATION_CANCELLED") return "stopped";
  if (message === "MEMORY_AUTHORITY_MISMATCH") return "authority_mismatch";
  if (error instanceof SyntaxError || error instanceof Error && (error.name === "ZodError"
    || ["MEMORY_INTEGRITY_ERROR", "MEMORY_TRANSITION_PROOF_INVALID", "HINDSIGHT_APPLICATION_CHECKPOINT_INVALID",
      "HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH"].includes(message))) return "evidence_invalid";
  return "connection_unavailable";
}
