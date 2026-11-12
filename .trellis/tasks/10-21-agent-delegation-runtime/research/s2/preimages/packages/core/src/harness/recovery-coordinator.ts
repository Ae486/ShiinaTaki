/**
 * INPUT: durable Run/Attempt/Effect repositories and closed provider recovery adapters
 * OUTPUT: bounded, idempotent boot classification before new dispatch is admitted
 * POS: core/harness — the sole restart/reconciliation coordinator; external probes are always outside SQLite transactions
 */
import { randomUUID } from "node:crypto";
import { ACCEPTED_WORK_PROVIDER, RecoveryReportSchema, type EffectLifecycle, type SnapshotReference, type RecoveryReport } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { RunRepo } from "../db/run-repo.ts";
import type { EffectLifecycleService } from "./effect-lifecycle-service.ts";
import { recoverInitiativeRun, recoverTerminalDeliveries } from "./initiative-recovery.ts";

export interface RecoveryProbeResult { classification: "completed" | "failed" | "unknown" | "unavailable"; summary?: string; errorCode?: string; }
export interface EffectRecoveryAdapter {
  supports(effect: EffectLifecycle): boolean;
  replayPosture(effect: EffectLifecycle, snapshot: SnapshotReference): "safe" | "never";
  reconcile(effect: EffectLifecycle, snapshot: SnapshotReference): Promise<RecoveryProbeResult>;
  replay?(effect: EffectLifecycle, snapshot: SnapshotReference): Promise<RecoveryProbeResult>;
}
export interface RecoveryCoordinator {
  scan(options?: { now?: string }): Promise<RecoveryReport>;
  isReady(): boolean;
  close(): void;
}

const TERMINAL_EFFECT = new Set(["completed", "failed"]);

// eslint-disable-next-line max-lines-per-function
export function createRecoveryCoordinator(input: {
  db: Database; runs: RunRepo; effects: EffectLifecycleService; adapters?: readonly EffectRecoveryAdapter[]; maxRuns?: number;
}): RecoveryCoordinator {
  const generation = randomUUID();
  let ready = false;
  let closed = false;
  const maxRuns = Math.min(input.maxRuns ?? 100, 1000);
  return {
    // eslint-disable-next-line max-lines-per-function
    async scan(options = {}) {
      if (closed) throw new Error("RECOVERY_CLOSED");
      const at = options.now ?? new Date().toISOString();
      recoverTerminalDeliveries(input.db);
      const ids = input.runs.listRecoverable(maxRuns);
      input.db.prepare("UPDATE core_process_generations SET status='gone',finished_at=:at WHERE status='running'").run({ at });
      input.db.prepare("INSERT INTO core_process_generations (generation_id,started_at,status) VALUES (:id,:at,'running')").run({ id: generation, at });
      let classified = 0; let terminal = 0;
      for (const runId of ids) {
        const status = input.runs.status(runId);
        if (["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"].includes(status.run.state)) continue;
        const acceptedWork = status.run.deliveryClass === "internal"
          && status.run.provenance.provider === ACCEPTED_WORK_PROVIDER && Boolean(status.run.provenance.sourceRef);
        // A trigger's initiator does not turn an accepted root into a Heartbeat decision Run.
        if (!acceptedWork && recoverInitiativeRun(input, status)) { classified++; terminal++; continue; }
        const deadlineExpired = Boolean(status.run.deadlineAt && Date.parse(status.run.deadlineAt) <= Date.parse(at));
        const effects = input.effects.list?.(runId) ?? input.effects.unfinished(runId);
        const unfinished = effects.filter((effect) => !TERMINAL_EFFECT.has(effect.outcome ?? "") && effect.state !== "terminal");
        if (status.run.state === "cancel_requested" && unfinished.length === 0) {
          input.runs.classifyRecovery({ runId, classification: "cancelled", reason: "cancel requested before recovery dispatch", now: at, generation });
          const classifiedStatus = input.runs.status(runId);
          input.runs.settle({ runId, attemptId: classifiedStatus.run.activeAttemptId!, outcome: "cancelled", retryability: "not_retryable", summary: "cancelled during recovery", errorCode: "cancel_requested" });
          classified++; terminal++; continue;
        }
        if (status.run.state === "cancel_requested" && unfinished.length > 0) {
          const unknown = unfinished.some((effect) => effect.state !== "waiting" && effect.state !== "prepared");
          for (const effect of unfinished) settleRecoveredEffect({ service: input.effects, effect, outcome: unknown ? "outcome_unknown" : "cancelled", summary: "cancelled during recovery" });
          input.runs.classifyRecovery({ runId, classification: unknown ? "outcome_unknown" : "cancelled", reason: "cancel requested during recovery", now: at, generation });
          const classifiedStatus = input.runs.status(runId);
          input.runs.settle({ runId, attemptId: classifiedStatus.run.activeAttemptId!, outcome: unknown ? "outcome_unknown" : "cancelled", retryability: "not_retryable", summary: unknown ? "cancelled after effect intent; outcome unknown" : "cancelled before effect intent", errorCode: unknown ? "cancelled_effect_unknown" : "cancel_requested" });
          classified++; terminal++; continue;
        }
        if (deadlineExpired && unfinished.length === 0) {
          input.runs.classifyRecovery({ runId, classification: "deadline_exceeded", reason: "captured deadline elapsed before recovery dispatch", now: at, generation });
          const classifiedStatus = input.runs.status(runId);
          input.runs.settle({ runId, attemptId: classifiedStatus.run.activeAttemptId!, outcome: "deadline_exceeded", retryability: "not_retryable", summary: "captured deadline elapsed before dispatch", errorCode: "deadline_exceeded" });
          classified++; terminal++; continue;
        }
        if (unfinished.length === 0) {
          // The immutable accepted purpose outlives its completed preparation Effects. Preserve
          // viewable work without restoring lost executable authority or replaying a model call.
          if (acceptedWork) {
            input.runs.classifyRecovery({ runId, classification: "waiting_for_authority",
              reason: "accepted work requires explicit continuation", now: at, generation });
            classified++; continue;
          }
          const lastTerminal = effects.at(-1);
          if (lastTerminal?.state === "terminal" && status.run.state !== "queued") {
            const outcome = lastTerminal.outcome === "completed" ? "completed" : lastTerminal.outcome === "deadline_exceeded" ? "deadline_exceeded" : lastTerminal.outcome === "cancelled" ? "cancelled" : lastTerminal.outcome === "failed" ? "failed" : "outcome_unknown";
            input.runs.classifyRecovery({ runId, classification: outcome === "completed" ? "completed" : outcome === "outcome_unknown" ? "outcome_unknown" : outcome === "cancelled" ? "cancelled" : outcome === "deadline_exceeded" ? "deadline_exceeded" : "failed", reason: "terminal effect repair", now: at, generation });
            const classifiedStatus = input.runs.status(runId);
            input.runs.settle({ runId, attemptId: classifiedStatus.run.activeAttemptId!, outcome, retryability: "not_retryable", summary: "repaired from terminal effect", errorCode: outcome === "outcome_unknown" ? "effect_outcome_unknown" : undefined });
            classified++; terminal++; continue;
          }
          input.runs.classifyRecovery({ runId, classification: "resumable_preparation", reason: "owner generation ended", now: at, generation });
          classified++; continue;
        }
        const budgetExceeded = status.run.budgetLimit !== undefined && status.run.budgetUsed >= status.run.budgetLimit;
        if (deadlineExpired || budgetExceeded) {
          const uncertain = unfinished.some((effect) => effect.state !== "waiting" && effect.state !== "prepared");
          for (const effect of unfinished) {
            settleRecoveredEffect({ service: input.effects, effect, outcome: uncertain ? "outcome_unknown" : "failed", summary: uncertain ? "captured control expired after effect intent" : "captured control expired before effect dispatch", errorCode: deadlineExpired ? "deadline_exceeded" : "budget_exceeded" });
          }
          const classification = uncertain ? "outcome_unknown" : deadlineExpired ? "deadline_exceeded" : "failed";
          input.runs.classifyRecovery({ runId, classification, reason: deadlineExpired ? "captured deadline elapsed during recovery" : "captured budget exhausted during recovery", now: at, generation });
          const classifiedStatus = input.runs.status(runId);
          input.runs.settle({ runId, attemptId: classifiedStatus.run.activeAttemptId!, outcome: uncertain ? "outcome_unknown" : deadlineExpired ? "deadline_exceeded" : "failed", retryability: "not_retryable", summary: uncertain ? "effect outcome unknown after captured control expired" : deadlineExpired ? "captured deadline elapsed before dispatch" : "captured budget exhausted before dispatch", errorCode: deadlineExpired ? "deadline_exceeded" : "budget_exceeded" });
          classified++; terminal++;
          continue;
        }
        if (acceptedWork) {
          // Even a newly available safe adapter lacks the retired accepted-source binding.
          // Preserve unknown work for explicit continuation; do not infer root completion.
          input.runs.classifyRecovery({ runId, classification: "reconciliation_required",
            reason: "accepted work requires explicit effect reconciliation", now: at, generation });
          classified++; continue;
        }
        let sawUnknown = false;
        for (const effect of unfinished) {
          const adapter = input.adapters?.find((candidate) => candidate.supports(effect));
          if (!adapter) { sawUnknown = true; continue; }
          const snapshot = status.run.snapshot;
          const currentPosture = adapter.replayPosture(effect, snapshot);
          const result = effect.replayPosture === "safe" && currentPosture === "safe" && adapter.replay
            ? await adapter.replay(effect, snapshot)
            : await adapter.reconcile(effect, snapshot);
          if (result.classification === "completed" || result.classification === "failed") {
            settleRecoveredEffect({ service: input.effects, effect, outcome: result.classification, summary: result.summary, errorCode: result.errorCode });
          } else sawUnknown = true;
        }
        if (sawUnknown) input.runs.classifyRecovery({ runId, classification: "reconciliation_required", reason: "effect outcome requires authority reconciliation", now: at, generation });
        else {
            const refreshed = input.effects.list?.(runId) ?? input.effects.unfinished(runId);
            const last = refreshed.at(-1);
            const outcome = last?.outcome === "completed" ? "completed" : "failed";
            input.runs.classifyRecovery({ runId, classification: outcome === "completed" ? "completed" : "failed", reason: "safe effect replay reconciled", now: at, generation });
            const classifiedStatus = input.runs.status(runId);
            input.runs.settle({ runId, attemptId: classifiedStatus.run.activeAttemptId!, outcome, retryability: "not_retryable", summary: "effect recovered under stored and current safe replay contracts" }); terminal++;
        }
        classified++;
      }
      input.db.prepare("UPDATE core_process_generations SET status='completed',finished_at=:at,scanned_count=:scanned,classified_count=:classified WHERE generation_id=:id").run({ id: generation, at, scanned: ids.length, classified });
      ready = true;
      return RecoveryReportSchema.parse({ processGeneration: generation, scanned: ids.length, classified, terminal });
    },
    isReady: () => ready,
    close: () => { closed = true; },
  };
}

function settleRecoveredEffect(input: { service: EffectLifecycleService; effect: EffectLifecycle; outcome: "completed" | "failed" | "cancelled" | "outcome_unknown"; summary?: string; errorCode?: string }): void {
  const { service, effect, outcome, summary, errorCode } = input;
  if (effect.state === "waiting" && service.settleWaiting && outcome !== "outcome_unknown") {
    service.settleWaiting({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId, expectedVersion: effect.version, outcome, summary, errorCode });
    return;
  }
  service.settle({ effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId, expectedVersion: effect.version, outcome, summary, errorCode });
}
