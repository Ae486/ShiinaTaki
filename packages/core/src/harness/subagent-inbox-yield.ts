/**
 * INPUT: actual recorded SDK stop frontier, completed Run/Effects and live foreground-yield ownership.
 * OUTPUT: disposable one-shot same-batch continuation certificates, consumed only when the Character lane is free.
 * POS: core/harness — known live read-only yields only; no durable replay eligibility or crash reconstruction.
 */
import type { StopCondition, ToolSet } from "ai";
import type { SubagentInboxResumeParams } from "@taki/shared";
import type { CompletedWorkStep } from "../agents/work-context.ts";
import { completedWorkerFrontier } from "../agents/worker-sdk-segment.ts";
import type { SubagentState } from "./subagent-state.ts";

export interface InboxYieldCertificate {
  characterId: string; consumerId: string; runId: string; attemptId: string; modelEffectId: string; stepNumber: number;
}

export function createInboxYieldWitness(state: SubagentState, input: {
  characterId: string; consumerId: string; runId: string; attemptId: string;
  signal: AbortSignal; requested(): boolean;
}) {
  let recorded: CompletedWorkStep | undefined;
  let stopped: InboxYieldCertificate | undefined;
  return {
    record(step: CompletedWorkStep) { recorded = step; stopped = undefined; },
    stop(options: Parameters<StopCondition<ToolSet>>[0], outstanding: boolean) {
      stopped = undefined;
      if (!outstanding) return true;
      if (!input.requested()) return false;
      const last = options.steps.at(-1);
      if (!input.signal.aborted && recorded?.completed === true && recorded.safeFrontier === true
        && recorded.naturalFinish === false && recorded.attemptId === input.attemptId && recorded.modelEffectId
        && last?.stepNumber === recorded.stepNumber && completedWorkerFrontier(last)) {
        stopped = { characterId: input.characterId, consumerId: input.consumerId, runId: input.runId,
          attemptId: input.attemptId, modelEffectId: recorded.modelEffectId, stepNumber: recorded.stepNumber };
      }
      return true;
    },
    certify(): InboxYieldCertificate | undefined {
      // Called only after the owning stream, recording and canonical settlement have all returned successfully.
      if (!stopped || state.closing || input.signal.aborted || !isReadOnlyYield(state, stopped)) return;
      return stopped;
    },
  };
}
export type InboxYieldWitness = ReturnType<typeof createInboxYieldWitness>;

function isReadOnlyYield(state: SubagentState, certificate: InboxYieldCertificate): boolean {
  const { deps } = state;
  const run = deps.runs.status(certificate.runId).run;
  if (run.state !== "completed" || run.activeAttemptId !== certificate.attemptId) return false;
  const consumer = deps.db.prepare("SELECT state FROM subagent_inbox_consumers WHERE consumer_id=:id AND run_id=:run")
    .get({ id: certificate.consumerId, run: certificate.runId });
  if (consumer?.state !== "reconciliation_needed" || deps.db.prepare("SELECT 1 FROM subagent_event_actions WHERE consumer_id=:id LIMIT 1")
    .get({ id: certificate.consumerId })) return false;
  const delivery = deps.db.prepare(`SELECT 1 FROM subagent_inbox_deliveries d JOIN run_effects e ON e.effect_id=d.model_effect_id
    WHERE d.consumer_id=:consumer AND d.model_effect_id=:effect AND d.step_number=:step AND e.run_id=:run AND e.attempt_id=:attempt`)
    .get({ consumer: certificate.consumerId, effect: certificate.modelEffectId, step: certificate.stepNumber,
      run: certificate.runId, attempt: certificate.attemptId });
  if (!delivery) return false;
  const effects = deps.effects.list?.(certificate.runId);
  if (!effects?.some((effect) => effect.effectId === certificate.modelEffectId && effect.kind === "model")
    || !effects.some((effect) => effect.kind === "tool")) return false;
  return effects.every((effect) => effect.state === "terminal" && effect.outcome === "completed"
    && (effect.kind === "model" || (effect.kind === "tool" && effect.sourceRef.type === "tool"
      && effect.sourceRef.toolName === "core.subagent.read")));
}

export function createInboxYieldContinuations(state: SubagentState, ports: {
  isActive(characterId: string): boolean;
  resume(input: SubagentInboxResumeParams, admission: InboxYieldAdmission): Promise<unknown>;
  hint(): void;
}) {
  const pending = new Map<string, InboxYieldCertificate>();
  return {
    remember(certificate: InboxYieldCertificate | undefined) {
      if (certificate && !state.closing) pending.set(certificate.consumerId, certificate);
    },
    forget(consumerId: string) { pending.delete(consumerId); },
    advance() {
      if (state.closing) return;
      for (const certificate of pending.values()) {
        if (ports.isActive(certificate.characterId) || state.deps.queue.isBusy(certificate.characterId)) continue;
        // Capture/authority failures consume the certificate; a proven rolled-back foreground reservation defers it.
        pending.delete(certificate.consumerId);
        const input = { characterId: certificate.characterId, consumerId: certificate.consumerId,
          operationKey: `cooperative-yield:${certificate.consumerId}` };
        const admission = createInboxYieldAdmission(state, input);
        const work = ports.resume(input, admission).then(() => undefined)
          .catch((error) => {
            if (!state.closing && admission.wasDeferred(error)) {
              pending.set(certificate.consumerId, certificate);
              // Cancellation may have released the reservation before rollback restored this pending entry.
              ports.hint();
            } else if (!state.closing) state.deps.reportError("SUBAGENT_INBOX_YIELD_CONTINUATION_UNAVAILABLE");
          })
          .finally(() => state.work.delete(work));
        state.work.add(work);
      }
    },
    close() { pending.clear(); },
  };
}

function createInboxYieldAdmission(state: SubagentState, input: SubagentInboxResumeParams) {
  const { db, queue } = state.deps;
  const version = queue.primaryVersion(input.characterId);
  const idempotencyKey = `inbox-resume:${input.consumerId}:${input.operationKey}`;
  const deferred = new Error("SUBAGENT_INBOX_YIELD_ADMISSION_DEFERRED");
  let proposedRunId: string | undefined;
  return {
    validateTx() {
      if (queue.primaryVersion(input.characterId) === version) return;
      const row = db.prepare("SELECT run_id FROM runs WHERE idempotency_key=:key").get({ key: idempotencyKey });
      if (!row) throw new Error("SUBAGENT_INBOX_YIELD_ADMISSION_WITNESS_REQUIRED");
      proposedRunId = String(row.run_id);
      throw deferred;
    },
    wasDeferred(error: unknown): boolean {
      if (error !== deferred || !proposedRunId || queue.primaryVersion(input.characterId) === version) return false;
      try {
        return !db.prepare("SELECT 1 FROM runs WHERE run_id=:run OR idempotency_key=:key")
          .get({ run: proposedRunId, key: idempotencyKey })
          && !db.prepare("SELECT 1 FROM run_effects WHERE run_id=:run LIMIT 1").get({ run: proposedRunId })
          && !db.prepare("SELECT 1 FROM subagent_inbox_consumers WHERE run_id=:run LIMIT 1").get({ run: proposedRunId })
          && !db.prepare("SELECT 1 FROM subagent_inbox_resumes WHERE previous_consumer_id=:id LIMIT 1")
            .get({ id: input.consumerId });
      } catch { return false; }
    },
  };
}
export type InboxYieldAdmission = ReturnType<typeof createInboxYieldAdmission>;
