/**
 * INPUT:  Run-owned Effect intents, waiting transitions, CAS settlements, and provider-neutral usage
 * OUTPUT: atomic Effect current state plus immutable Effect/Usage events and detailed usage rows
 * POS:    core/db — sole SQLite writer for Run Effects and authoritative model usage
 */
import { randomUUID } from "node:crypto";
import { EffectLifecycleSchema, UsageRecordSchema, type EffectLifecycle, type RunEvent, type UsageRecord } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import type { RunEventRepo } from "./run-event-repo.ts";
import type { RunEventLiveBus } from "./run-event-live.ts";

export interface EffectIntentInput {
  effectId?: string; runId: string; attemptId: string; kind: EffectLifecycle["kind"]; sourceRef: EffectLifecycle["sourceRef"];
  executorRef?: EffectLifecycle["executorRef"] | undefined; inputDigest?: string; replayPosture: EffectLifecycle["replayPosture"];
  capturedGenerationRef?: string; idempotencyKey?: string; reservedResultRef?: string; reservedUsageRef?: string; now?: string;
  approvalRef?: EffectLifecycle["approvalRef"];
}
export type EffectWaitingInput = Omit<EffectIntentInput, "approvalRef"> & { approvalRef: NonNullable<EffectLifecycle["approvalRef"]> };
export interface EffectSettlementInput {
  effectId: string; runId: string; attemptId: string; expectedVersion: number; outcome: NonNullable<EffectLifecycle["outcome"]>;
  summary?: string; errorCode?: string; usage?: Omit<UsageRecord, "usageId" | "schemaVersion" | "runId" | "attemptId" | "effectId" | "recordedAt">;
  now?: string;
}
export interface EffectRepo {
  prepareWaiting(input: EffectWaitingInput): EffectLifecycle;
  settleWaiting(input: { effectId: string; runId: string; attemptId: string; expectedVersion: number; outcome: "completed" | "failed" | "cancelled" | "deadline_exceeded"; summary?: string; errorCode?: string; now?: string }): { effect: EffectLifecycle; stale: boolean; duplicate: boolean };
  commitIntent(input: { effectId: string; runId: string; attemptId: string; expectedVersion: number; now?: string }): { effect: EffectLifecycle; stale: boolean; duplicate: boolean };
  prepareIntent(input: EffectIntentInput): EffectLifecycle;
  settle(input: EffectSettlementInput): { effect?: EffectLifecycle; duplicate: boolean; stale: boolean; usage?: UsageRecord };
  get(effectId: string): EffectLifecycle | undefined;
  listUnfinished(runId?: string): EffectLifecycle[];
  list(runId: string): EffectLifecycle[];
}

const ACTIVE_ATTEMPT_STATES = new Set(["intent_committed", "effect_running", "settling"]);
const ACTIVE_ATTEMPT_STATE_SQL = "'intent_committed','effect_running','settling'";

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
    approvalRef: row.approval_ref_json ? JSON.parse(String(row.approval_ref_json)) : undefined,
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
        kind: input.kind, state: "intent_committed", version: 0, sourceRef: input.sourceRef, executorRef: input.executorRef, approvalRef: input.approvalRef,
        inputDigest: input.inputDigest, replayPosture: input.replayPosture, capturedGenerationRef: input.capturedGenerationRef,
        idempotencyKey: input.idempotencyKey, reservedResultRef: input.reservedResultRef ?? randomUUID(),
        reservedUsageRef: input.reservedUsageRef ?? randomUUID(), startedAt: at });
      let events: RunEvent[] = [];
      db.transaction(() => {
        reserveRunBudget(db, input.runId);
        db.prepare(`INSERT INTO run_effects (effect_id,run_id,attempt_id,schema_version,kind,state,state_version,source_ref_json,executor_ref_json,approval_ref_json,input_digest,replay_posture,captured_generation_ref,idempotency_key,reserved_result_ref,reserved_usage_ref,started_at,created_at,updated_at) VALUES (:effectId,:runId,:attemptId,:schemaVersion,:kind,:state,0,:source,:executor,:approval,:digest,:replay,:generation,:idempotency,:result,:usage,:started,:at,:at)`).run({ effectId, runId: input.runId, attemptId: input.attemptId, schemaVersion: effect.schemaVersion, kind: effect.kind, state: effect.state, source: JSON.stringify(effect.sourceRef), executor: effect.executorRef ? JSON.stringify(effect.executorRef) : null, approval: effect.approvalRef ? JSON.stringify(effect.approvalRef) : null, digest: effect.inputDigest ?? null, replay: effect.replayPosture, generation: effect.capturedGenerationRef ?? null, idempotency: effect.idempotencyKey ?? null, result: effect.reservedResultRef ?? null, usage: effect.reservedUsageRef ?? null, started: at, at });
        const attemptChanged = db.prepare("UPDATE run_attempts SET state_version=state_version+1 WHERE attempt_id=:attemptId AND run_id=:runId AND state IN ('intent_committed','effect_running')").run({ attemptId: input.attemptId, runId: input.runId });
        if (attemptChanged.changes !== 1) throw new Error("EFFECT_ATTEMPT_NOT_ACTIVE");
        events = append(effectEvent(input.runId, input.attemptId, "effect.intent_committed", at, { kind: "effect.intent_committed", state: "intent_committed", effectId, effectKind: input.kind, sourceRef: effect.sourceRef, capturedGenerationRef: effect.capturedGenerationRef, replayPosture: input.replayPosture }));
      });
      try { liveBus?.publish(events); } catch { /* observer failure cannot alter committed intent */ }
      return effect;
    },
    prepareWaiting(input) {
      if (!input.approvalRef) throw new Error("EFFECT_APPROVAL_REF_REQUIRED");
      const at = input.now ?? now(); const effectId = input.effectId ?? randomUUID();
      const effect = EffectLifecycleSchema.parse({ schemaVersion: "effect.v1", effectId, runId: input.runId, attemptId: input.attemptId, kind: input.kind, state: "waiting", version: 0, sourceRef: input.sourceRef, executorRef: input.executorRef, approvalRef: input.approvalRef, inputDigest: input.inputDigest, replayPosture: input.replayPosture, capturedGenerationRef: input.capturedGenerationRef, idempotencyKey: input.idempotencyKey, reservedResultRef: input.reservedResultRef ?? randomUUID(), reservedUsageRef: input.reservedUsageRef ?? randomUUID(), startedAt: at });
      let events: RunEvent[] = [];
      db.transaction(() => {
        const attemptChanged = db.prepare(`UPDATE run_attempts SET state_version=state_version+1 WHERE attempt_id=:attemptId AND run_id=:runId AND state IN (${ACTIVE_ATTEMPT_STATE_SQL})`).run({ attemptId: input.attemptId, runId: input.runId });
        if (attemptChanged.changes !== 1) throw new Error("EFFECT_ATTEMPT_NOT_ACTIVE");
        db.prepare(`INSERT INTO run_effects (effect_id,run_id,attempt_id,schema_version,kind,state,state_version,source_ref_json,executor_ref_json,approval_ref_json,input_digest,replay_posture,captured_generation_ref,idempotency_key,reserved_result_ref,reserved_usage_ref,started_at,created_at,updated_at) VALUES (:effectId,:runId,:attemptId,:schemaVersion,:kind,:state,0,:source,:executor,:approval,:digest,:replay,:generation,:idempotency,:result,:usage,:started,:at,:at)`).run({ effectId, runId: input.runId, attemptId: input.attemptId, schemaVersion: effect.schemaVersion, kind: effect.kind, state: effect.state, source: JSON.stringify(effect.sourceRef), executor: effect.executorRef ? JSON.stringify(effect.executorRef) : null, approval: effect.approvalRef ? JSON.stringify(effect.approvalRef) : null, digest: effect.inputDigest ?? null, replay: effect.replayPosture, generation: effect.capturedGenerationRef ?? null, idempotency: effect.idempotencyKey ?? null, result: effect.reservedResultRef ?? null, usage: effect.reservedUsageRef ?? null, started: at, at });
        events = append(effectEvent(input.runId, input.attemptId, "effect.waiting", at, { kind: "effect.waiting", state: "waiting", effectId, effectKind: input.kind, sourceRef: effect.sourceRef, capturedGenerationRef: effect.capturedGenerationRef, replayPosture: input.replayPosture, approvalId: input.approvalRef?.approvalId, policyGeneration: input.approvalRef?.policyGeneration, approvalGeneration: input.approvalRef?.approvalGeneration, bindingDigest: input.approvalRef?.bindingDigest, expiresAt: input.approvalRef?.expiresAt }));
      });
      try { liveBus?.publish(events); } catch { /* observer failure cannot alter committed wait */ }
      return effect;
    },
    settleWaiting(input) {
      const current = read(db.prepare("SELECT * FROM run_effects WHERE effect_id=:effectId").get({ effectId: input.effectId }) ?? {});
      if (current.runId !== input.runId || current.attemptId !== input.attemptId || current.version !== input.expectedVersion) return { effect: current, stale: true, duplicate: false };
      if (current.state === "terminal") return { effect: current, stale: false, duplicate: true };
      if (current.state !== "waiting" || !isActiveAttempt(db, input.runId, input.attemptId)) return { effect: current, stale: true, duplicate: false };
      const at = input.now ?? now(); let events: RunEvent[] = [];
      let stale = false;
      try { db.transaction(() => {
        const changed = db.prepare("UPDATE run_effects SET state='terminal',state_version=state_version+1,settled_at=:at,outcome=:outcome,error_code=:errorCode,summary=:summary,updated_at=:at WHERE effect_id=:effectId AND run_id=:runId AND attempt_id=:attemptId AND state='waiting' AND state_version=:version").run({ effectId: input.effectId, runId: input.runId, attemptId: input.attemptId, version: input.expectedVersion, at, outcome: input.outcome, errorCode: input.errorCode ?? null, summary: input.summary?.slice(0, 500) ?? null });
        if (changed.changes !== 1) { stale = true; throw new Error("EFFECT_WAIT_STALE_VERSION"); }
        const attemptChanged = db.prepare(`UPDATE run_attempts SET state_version=state_version+1 WHERE attempt_id=:attemptId AND run_id=:runId AND state IN (${ACTIVE_ATTEMPT_STATE_SQL})`).run({ attemptId: input.attemptId, runId: input.runId });
        if (attemptChanged.changes !== 1) { stale = true; throw new Error("EFFECT_ATTEMPT_NOT_ACTIVE"); }
        events = append(effectEvent(input.runId, input.attemptId, "effect.settled", at, { kind: "effect.settled", state: "terminal", effectId: current.effectId, effectKind: current.kind, sourceRef: current.sourceRef, capturedGenerationRef: current.capturedGenerationRef, replayPosture: current.replayPosture, outcome: input.outcome, summary: input.summary?.slice(0, 100), errorCode: input.errorCode?.slice(0, 100) }));
      }); } catch (error) { if (!stale) throw error; }
      if (stale) return { effect: read(db.prepare("SELECT * FROM run_effects WHERE effect_id=:effectId").get({ effectId: input.effectId }) as Record<string, unknown>), stale: true, duplicate: false };
      try { liveBus?.publish(events); } catch { /* observer failure cannot alter committed wait settlement */ }
      return { effect: { ...current, state: "terminal", version: current.version + 1, settledAt: at, outcome: input.outcome, summary: input.summary?.slice(0, 500), errorCode: input.errorCode?.slice(0, 100) }, stale: false, duplicate: false };
    },
    commitIntent(input) {
      const current = read(db.prepare("SELECT * FROM run_effects WHERE effect_id=:effectId").get({ effectId: input.effectId }) ?? {});
      if (current.runId !== input.runId || current.attemptId !== input.attemptId || current.version !== input.expectedVersion) return { effect: current, stale: true, duplicate: false };
      if (!isActiveAttempt(db, input.runId, input.attemptId)) return { effect: current, stale: true, duplicate: false };
      if (current.state === "intent_committed" || current.state === "effect_running") return { effect: current, stale: false, duplicate: true };
      if (current.state !== "waiting") return { effect: current, stale: true, duplicate: false };
      const at = input.now ?? now(); let events: RunEvent[] = [];
      let stale = false;
      try { db.transaction(() => {
        reserveRunBudget(db, input.runId);
        const changed = db.prepare("UPDATE run_effects SET state='intent_committed',state_version=state_version+1,updated_at=:at WHERE effect_id=:effectId AND run_id=:runId AND attempt_id=:attemptId AND state='waiting' AND state_version=:version").run({ effectId: input.effectId, runId: input.runId, attemptId: input.attemptId, version: input.expectedVersion, at });
        if (changed.changes !== 1) { stale = true; throw new Error("EFFECT_WAIT_STALE_VERSION"); }
        const attemptChanged = db.prepare(`UPDATE run_attempts SET state_version=state_version+1 WHERE attempt_id=:attemptId AND run_id=:runId AND state IN (${ACTIVE_ATTEMPT_STATE_SQL})`).run({ attemptId: input.attemptId, runId: input.runId });
        if (attemptChanged.changes !== 1) { stale = true; throw new Error("EFFECT_ATTEMPT_NOT_ACTIVE"); }
        events = append(effectEvent(input.runId, input.attemptId, "effect.intent_committed", at, { kind: "effect.intent_committed", state: "intent_committed", effectId: current.effectId, effectKind: current.kind, sourceRef: current.sourceRef, capturedGenerationRef: current.capturedGenerationRef, replayPosture: current.replayPosture, approvalId: current.approvalRef?.approvalId, policyGeneration: current.approvalRef?.policyGeneration, approvalGeneration: current.approvalRef?.approvalGeneration, bindingDigest: current.approvalRef?.bindingDigest, expiresAt: current.approvalRef?.expiresAt }));
      }); } catch (error) { if (!stale) throw error; }
      if (stale) return { effect: read(db.prepare("SELECT * FROM run_effects WHERE effect_id=:effectId").get({ effectId: input.effectId }) as Record<string, unknown>), stale: true, duplicate: false };
      try { liveBus?.publish(events); } catch { /* observer failure cannot alter committed intent */ }
      return { effect: { ...current, state: "intent_committed", version: current.version + 1 }, stale: false, duplicate: false };
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
      try { db.transaction(() => {
        const attempt = db.prepare("SELECT state FROM run_attempts WHERE attempt_id=:attemptId AND run_id=:runId").get({ attemptId: input.attemptId, runId: input.runId }) as { state?: string } | undefined;
        if (!attempt || !ACTIVE_ATTEMPT_STATES.has(String(attempt.state))) { stale = true; throw new Error("EFFECT_ATTEMPT_NOT_ACTIVE"); }
        const changed = db.prepare("UPDATE run_effects SET state='terminal',state_version=state_version+1,settled_at=:at,outcome=:outcome,error_code=:errorCode,summary=:summary,updated_at=:at WHERE effect_id=:effectId AND run_id=:runId AND attempt_id=:attemptId AND state_version=:version AND state<>'terminal'").run({ effectId: input.effectId, runId: input.runId, attemptId: input.attemptId, version: input.expectedVersion, at, outcome: input.outcome, errorCode: input.errorCode ?? null, summary: input.summary?.slice(0, 500) ?? null });
        if (changed.changes !== 1) { stale = true; throw new Error("EFFECT_STALE_VERSION"); }
        const attemptChanged = db.prepare(`UPDATE run_attempts SET state_version=state_version+1 WHERE attempt_id=:attemptId AND run_id=:runId AND state IN (${ACTIVE_ATTEMPT_STATE_SQL})`).run({ attemptId: input.attemptId, runId: input.runId });
        if (attemptChanged.changes !== 1) { stale = true; throw new Error("EFFECT_ATTEMPT_NOT_ACTIVE"); }
        events = append(effectEvent(input.runId, input.attemptId, "effect.settled", at, { kind: "effect.settled", state: "terminal", effectId: current.effectId, effectKind: current.kind, sourceRef: current.sourceRef, capturedGenerationRef: current.capturedGenerationRef, replayPosture: current.replayPosture, outcome: input.outcome, summary: input.summary?.slice(0, 100), errorCode: input.errorCode?.slice(0, 100) }));
        const fallbackUsage = current.kind === "model" && current.sourceRef.type === "model"
          ? { provider: current.sourceRef.provider, modelId: current.sourceRef.modelId, quality: "unknown" as const }
          : undefined;
        const acceptedUsage = input.usage ?? fallbackUsage;
        if (acceptedUsage) {
          usage = insertUsage({ db, settlement: input, effect: current, acceptedUsage, recordedAt: at });
          events.push(...append(effectEvent(input.runId, input.attemptId, "usage.settled", at, {
            kind: "usage.settled", state: "settled", effectId: input.effectId, usageId: usage.usageId,
            quality: usage.quality, inputTokens: usage.inputTokens,
            inputTokenDetails: usage.inputTokenDetails, outputTokens: usage.outputTokens,
            outputTokenDetails: usage.outputTokenDetails, totalTokens: usage.totalTokens,
          })));
        }
      }); } catch (error) { if (!stale) throw error; }
      if (stale) return { effect: read(db.prepare("SELECT * FROM run_effects WHERE effect_id=:effectId").get({ effectId: input.effectId }) as Record<string, unknown>), duplicate: false, stale: true };
      try { liveBus?.publish(events); } catch { /* observer failure cannot alter committed settlement */ }
      return { effect: settled, duplicate: false, stale: false, usage };
    },
    get(effectId) { const row = db.prepare("SELECT * FROM run_effects WHERE effect_id=:effectId").get({ effectId }); return row ? read(row) : undefined; },
    listUnfinished(runId) { const rows = runId ? db.prepare("SELECT * FROM run_effects WHERE run_id=:runId AND state<>'terminal' ORDER BY created_at").all({ runId }) : db.prepare("SELECT * FROM run_effects WHERE state<>'terminal' ORDER BY created_at").all(); return rows.map(read); },
    list(runId) { return db.prepare("SELECT * FROM run_effects WHERE run_id=:runId ORDER BY created_at").all({ runId }).map(read); },
  };
}

function insertUsage(args: {
  db: Database;
  settlement: EffectSettlementInput;
  effect: EffectLifecycle;
  acceptedUsage: NonNullable<EffectSettlementInput["usage"]>;
  recordedAt: string;
}): UsageRecord {
  const usage = UsageRecordSchema.parse({
    schemaVersion: "effect.v1", usageId: args.effect.reservedUsageRef ?? randomUUID(),
    runId: args.settlement.runId, attemptId: args.settlement.attemptId, effectId: args.settlement.effectId,
    ...args.acceptedUsage, recordedAt: args.recordedAt,
  });
  args.db.prepare(`INSERT INTO run_usage (
    usage_id,run_id,attempt_id,effect_id,schema_version,provider,model_id,quality,input_tokens,
    input_no_cache_tokens,cache_read_tokens,cache_write_tokens,output_tokens,output_text_tokens,
    reasoning_tokens,total_tokens,recorded_at
  ) VALUES (
    :usageId,:runId,:attemptId,:effectId,:schemaVersion,:provider,:modelId,:quality,:inputTokens,
    :inputNoCacheTokens,:cacheReadTokens,:cacheWriteTokens,:outputTokens,:outputTextTokens,
    :reasoningTokens,:totalTokens,:recordedAt
  )`).run({
    usageId: usage.usageId, runId: usage.runId, attemptId: usage.attemptId, effectId: usage.effectId,
    schemaVersion: usage.schemaVersion, provider: usage.provider, modelId: usage.modelId, quality: usage.quality,
    inputTokens: usage.inputTokens ?? null,
    inputNoCacheTokens: usage.inputTokenDetails?.noCacheTokens ?? null,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    outputTextTokens: usage.outputTokenDetails?.textTokens ?? null,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? null,
    totalTokens: usage.totalTokens ?? null, recordedAt: usage.recordedAt,
  });
  return usage;
}

function isActiveAttempt(db: Database, runId: string, attemptId: string): boolean {
  const row = db.prepare("SELECT state FROM run_attempts WHERE attempt_id=:attemptId AND run_id=:runId").get({ attemptId, runId }) as { state?: unknown } | undefined;
  return row !== undefined && ACTIVE_ATTEMPT_STATES.has(String(row.state));
}

function reserveRunBudget(db: Database, runId: string): void {
  const changed = db.prepare(`UPDATE runs SET budget_used=budget_used+1
    WHERE run_id=:runId AND (budget_limit IS NULL OR budget_used < budget_limit)`).run({ runId });
  if (changed.changes !== 1) throw new Error("RUN_BUDGET_EXHAUSTED");
}
