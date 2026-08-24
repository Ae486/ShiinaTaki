import { randomUUID } from "node:crypto";
import { EffectLifecycleSchema, UsageRecordSchema, type EffectLifecycle, type RunEvent, type UsageRecord } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import type { RunEventRepo } from "./run-event-repo.ts";
import type { RunEventLiveBus } from "./run-event-live.ts";

export interface EffectIntentInput {
  effectId?: string; runId: string; attemptId: string; kind: EffectLifecycle["kind"]; sourceRef: EffectLifecycle["sourceRef"];
  executorRef?: EffectLifecycle["executorRef"] | undefined; inputDigest?: string; replayPosture: EffectLifecycle["replayPosture"];
  capturedGenerationRef?: string; idempotencyKey?: string; reservedResultRef?: string; reservedUsageRef?: string; now?: string;
}
export interface EffectSettlementInput {
  effectId: string; runId: string; attemptId: string; expectedVersion: number; outcome: NonNullable<EffectLifecycle["outcome"]>;
  summary?: string; errorCode?: string; usage?: Omit<UsageRecord, "usageId" | "schemaVersion" | "runId" | "attemptId" | "effectId" | "recordedAt">;
  now?: string;
}
export interface EffectRepo {
  prepareIntent(input: EffectIntentInput): EffectLifecycle;
  settle(input: EffectSettlementInput): { effect?: EffectLifecycle; duplicate: boolean; stale: boolean; usage?: UsageRecord };
  get(effectId: string): EffectLifecycle | undefined;
  listUnfinished(runId?: string): EffectLifecycle[];
}

// eslint-disable-next-line max-lines-per-function
export function createEffectRepo(db: Database, eventRepo: RunEventRepo, liveBus?: RunEventLiveBus): EffectRepo {
  const now = () => new Date().toISOString();
  const read = (row: Record<string, unknown>): EffectLifecycle => EffectLifecycleSchema.parse({
    schemaVersion: row.schema_version, effectId: row.effect_id, runId: row.run_id, attemptId: row.attempt_id,
    kind: row.kind, state: row.state, version: Number(row.state_version), sourceRef: JSON.parse(String(row.source_ref_json)),
    executorRef: row.executor_ref_json ? JSON.parse(String(row.executor_ref_json)) : undefined, inputDigest: row.input_digest ?? undefined,
    replayPosture: row.replay_posture, capturedGenerationRef: row.captured_generation_ref ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined, reservedResultRef: row.reserved_result_ref ?? undefined,
    reservedUsageRef: row.reserved_usage_ref ?? undefined, startedAt: row.started_at ?? undefined, settledAt: row.settled_at ?? undefined,
    outcome: row.outcome ?? undefined, errorCode: row.error_code ?? undefined, summary: row.summary ?? undefined,
  });
  const append = (event: Omit<RunEvent, "eventId" | "seq">): RunEvent[] => eventRepo.appendMany([event]);
  // eslint-disable-next-line max-params
  const effectEvent = (runId: string, attemptId: string, kind: RunEvent["kind"], occurredAt: string, payload: RunEvent["payload"]): Omit<RunEvent, "eventId" | "seq"> => ({
    runId, attemptId, schemaVersion: "run-event.v1", category: kind === "usage.settled" ? "usage" : "effect", kind,
    occurredAt, source: "core.effect-lifecycle", payload,
  });
  return {
    prepareIntent(input) {
      const at = input.now ?? now(); const effectId = input.effectId ?? randomUUID();
      const effect = EffectLifecycleSchema.parse({ schemaVersion: "effect.v1", effectId, runId: input.runId, attemptId: input.attemptId,
        kind: input.kind, state: "intent_committed", version: 0, sourceRef: input.sourceRef, executorRef: input.executorRef,
        inputDigest: input.inputDigest, replayPosture: input.replayPosture, capturedGenerationRef: input.capturedGenerationRef,
        idempotencyKey: input.idempotencyKey, reservedResultRef: input.reservedResultRef ?? randomUUID(),
        reservedUsageRef: input.reservedUsageRef ?? randomUUID(), startedAt: at });
      let events: RunEvent[] = [];
      db.transaction(() => {
        db.prepare(`INSERT INTO run_effects (effect_id,run_id,attempt_id,schema_version,kind,state,state_version,source_ref_json,executor_ref_json,input_digest,replay_posture,captured_generation_ref,idempotency_key,reserved_result_ref,reserved_usage_ref,started_at,created_at,updated_at) VALUES (:effectId,:runId,:attemptId,:schemaVersion,:kind,:state,0,:source,:executor,:digest,:replay,:generation,:idempotency,:result,:usage,:started,:at,:at)`).run({ effectId, runId: input.runId, attemptId: input.attemptId, schemaVersion: effect.schemaVersion, kind: effect.kind, state: effect.state, source: JSON.stringify(effect.sourceRef), executor: effect.executorRef ? JSON.stringify(effect.executorRef) : null, digest: effect.inputDigest ?? null, replay: effect.replayPosture, generation: effect.capturedGenerationRef ?? null, idempotency: effect.idempotencyKey ?? null, result: effect.reservedResultRef ?? null, usage: effect.reservedUsageRef ?? null, started: at, at });
        const attemptChanged = db.prepare("UPDATE run_attempts SET state_version=state_version+1 WHERE attempt_id=:attemptId AND run_id=:runId AND state IN ('intent_committed','effect_running')").run({ attemptId: input.attemptId, runId: input.runId });
        if (attemptChanged.changes !== 1) throw new Error("EFFECT_ATTEMPT_NOT_ACTIVE");
        events = append(effectEvent(input.runId, input.attemptId, "effect.intent_committed", at, { kind: "effect.intent_committed", state: "intent_committed", effectId, effectKind: input.kind, sourceRef: effect.sourceRef, capturedGenerationRef: effect.capturedGenerationRef, replayPosture: input.replayPosture }));
      });
      try { liveBus?.publish(events); } catch { /* observer failure cannot alter committed intent */ }
      return effect;
    },
    settle(input) {
      const row = db.prepare("SELECT * FROM run_effects WHERE effect_id=:effectId").get({ effectId: input.effectId });
      if (!row) return { effect: undefined, duplicate: false, stale: true };
      const current = read(row);
      if (current.runId !== input.runId || current.attemptId !== input.attemptId) return { effect: current, duplicate: false, stale: true };
      if (current.state === "terminal") return { effect: current, duplicate: true, stale: false };
      if (current.version !== input.expectedVersion) return { effect: current, duplicate: false, stale: true };
      const at = input.now ?? now(); const settled = EffectLifecycleSchema.parse({ ...current, state: "terminal", version: current.version + 1, settledAt: at, outcome: input.outcome, summary: input.summary?.slice(0, 500), errorCode: input.errorCode?.slice(0, 100) });
      let events: RunEvent[] = []; let usage: UsageRecord | undefined; let stale = false;
      db.transaction(() => {
        const attempt = db.prepare("SELECT state FROM run_attempts WHERE attempt_id=:attemptId AND run_id=:runId").get({ attemptId: input.attemptId, runId: input.runId }) as { state?: string } | undefined;
        if (!attempt || !["intent_committed", "effect_running", "settling"].includes(String(attempt.state))) { stale = true; return; }
        const changed = db.prepare("UPDATE run_effects SET state='terminal',state_version=state_version+1,settled_at=:at,outcome=:outcome,error_code=:errorCode,summary=:summary,updated_at=:at WHERE effect_id=:effectId AND run_id=:runId AND attempt_id=:attemptId AND state_version=:version AND state<>'terminal'").run({ effectId: input.effectId, runId: input.runId, attemptId: input.attemptId, version: input.expectedVersion, at, outcome: input.outcome, errorCode: input.errorCode ?? null, summary: input.summary?.slice(0, 500) ?? null });
        if (changed.changes !== 1) { stale = true; return; }
        const attemptChanged = db.prepare("UPDATE run_attempts SET state_version=state_version+1 WHERE attempt_id=:attemptId AND run_id=:runId AND state IN ('intent_committed','effect_running','settling')").run({ attemptId: input.attemptId, runId: input.runId });
        if (attemptChanged.changes !== 1) { stale = true; return; }
        events = append(effectEvent(input.runId, input.attemptId, "effect.settled", at, { kind: "effect.settled", state: "terminal", effectId: current.effectId, effectKind: current.kind, sourceRef: current.sourceRef, capturedGenerationRef: current.capturedGenerationRef, replayPosture: current.replayPosture, outcome: input.outcome, summary: input.summary?.slice(0, 100), errorCode: input.errorCode?.slice(0, 100) }));
        const fallbackUsage = current.kind === "model" && current.sourceRef.type === "model"
          ? { provider: current.sourceRef.provider, modelId: current.sourceRef.modelId, quality: "unknown" as const }
          : undefined;
        const acceptedUsage = input.usage ?? fallbackUsage;
        if (acceptedUsage) {
          usage = UsageRecordSchema.parse({ schemaVersion: "effect.v1", usageId: current.reservedUsageRef ?? randomUUID(), runId: input.runId, attemptId: input.attemptId, effectId: input.effectId, ...acceptedUsage, recordedAt: at });
          db.prepare("INSERT INTO run_usage (usage_id,run_id,attempt_id,effect_id,schema_version,provider,model_id,quality,input_tokens,output_tokens,total_tokens,recorded_at) VALUES (:usageId,:runId,:attemptId,:effectId,:schemaVersion,:provider,:modelId,:quality,:inputTokens,:outputTokens,:totalTokens,:recordedAt)").run({ usageId: usage.usageId, runId: usage.runId, attemptId: usage.attemptId, effectId: usage.effectId, schemaVersion: usage.schemaVersion, provider: usage.provider, modelId: usage.modelId, quality: usage.quality, inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, totalTokens: usage.totalTokens ?? null, recordedAt: usage.recordedAt });
          events.push(...append(effectEvent(input.runId, input.attemptId, "usage.settled", at, { kind: "usage.settled", state: "settled", effectId: input.effectId, usageId: usage.usageId, quality: usage.quality, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens })));
        }
      });
      if (stale) return { effect: read(db.prepare("SELECT * FROM run_effects WHERE effect_id=:effectId").get({ effectId: input.effectId }) as Record<string, unknown>), duplicate: false, stale: true };
      try { liveBus?.publish(events); } catch { /* observer failure cannot alter committed settlement */ }
      return { effect: settled, duplicate: false, stale: false, usage };
    },
    get(effectId) { const row = db.prepare("SELECT * FROM run_effects WHERE effect_id=:effectId").get({ effectId }); return row ? read(row) : undefined; },
    listUnfinished(runId) { const rows = runId ? db.prepare("SELECT * FROM run_effects WHERE run_id=:runId AND state<>'terminal' ORDER BY created_at").all({ runId }) : db.prepare("SELECT * FROM run_effects WHERE state<>'terminal' ORDER BY created_at").all(); return rows.map(read); },
  };
}
