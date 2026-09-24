/**
 * INPUT:  memory-unavailable Hindsight Run events (late-bound from the composition), the marker, the lifecycle service's
 *         live reads and the operation service's submit
 * OUTPUT: createHindsightLifecycleTrigger() -> onUnavailable() (R8: bank.provision once per Character + fingerprint on
 *         bank_not_ready, connection.revalidate once per epoch + fingerprint on a revalidatable config_changed) and bind()
 * POS:    core/memory/hindsight-lifecycle — automatic origin through the same kinds and admission; the once-guard is the
 *         persisted operation rows; a busy family refuses and nothing is queued; never throws into the Run
 */
import type { MemoryOperationRequest } from "@taki/shared";
import { automaticLifecycleAttempted, type AutomaticLifecycleAttempt } from "../../db/hindsight-lifecycle-attempt-reads.ts";
import type { Database } from "../../db/sqlite.ts";
import type { Logger } from "../../logging/logger.ts";
import type { HindsightUnavailableRunEvent } from "../hindsight/hindsight-memory-runtime.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { MemoryOperationService } from "../operations/memory-operation-service.ts";
import type { HindsightLifecycleService } from "./hindsight-lifecycle-service.ts";

export interface HindsightLifecycleTrigger {
  onUnavailable(event: HindsightUnavailableRunEvent): void;
  bind(input: { lifecycle: HindsightLifecycleService; operations: Pick<MemoryOperationService, "submit"> }): void;
}
interface Bound { lifecycle: HindsightLifecycleService; operations: Pick<MemoryOperationService, "submit"> }
interface Planned { attempt: AutomaticLifecycleAttempt; request: MemoryOperationRequest }

export function createHindsightLifecycleTrigger(input: { db: Database; logger: Logger }): HindsightLifecycleTrigger {
  let bound: Bound | undefined;
  return {
    bind: (next) => { bound = next; },
    onUnavailable: (event) => {
      if (!bound || bound.lifecycle.stopRequested()) return;
      try {
        const planned = plan(input.db, bound.lifecycle, event);
        if (!planned || automaticLifecycleAttempted(input.db, planned.attempt)) return;
        const operation = bound.operations.submit(planned.request, { origin: "automatic" });
        input.logger.info({ kind: planned.request.kind, operationId: operation.operationId }, "automatic Hindsight lifecycle operation submitted");
      } catch (error) {
        // A refusal (busy family, changed state) leaves the Run degraded; the operator action stays available.
        input.logger.warn({ kind: event.reason, code: error instanceof Error ? error.message : "UNKNOWN" }, "automatic Hindsight lifecycle operation not submitted");
      }
    },
  };
}

function plan(db: Database, lifecycle: HindsightLifecycleService, event: HindsightUnavailableRunEvent): Planned | null {
  const selection = readMemoryAuthoritySelection(db);
  if (selection.mode !== "hindsight" || selection.epochId === null) return null;
  if (event.reason === "bank_not_ready") {
    const runtime = lifecycle.runtime();
    if (!runtime || runtime.epochId !== selection.epochId) return null;
    return { attempt: { kind: "bank.provision", characterId: event.characterId, configFingerprint: runtime.configFingerprint },
      request: { kind: "bank.provision", characterId: event.characterId } };
  }
  if (event.reason !== "config_changed") return null;
  const live = lifecycle.live();
  // Lineage, deployment mode and template revision changes are Stage 4/5: only the operator decides those.
  if (live.state !== "ready" || lifecycle.revalidateBlocker(live, selection.epochId) !== null) return null;
  return { attempt: { kind: "connection.revalidate", epochId: selection.epochId, configFingerprint: live.fingerprint },
    request: { kind: "connection.revalidate", expectedEpochId: selection.epochId } };
}
