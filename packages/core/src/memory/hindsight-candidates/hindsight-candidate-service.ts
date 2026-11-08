/**
 * INPUT:  controlling-Core storage, trusted admitted-source lookup and an explicitly supplied candidate driver
 * OUTPUT: Memory Operation admission/checkpoint/recovery seams with one-use dispatch and original-resource observation
 * POS:    D1-B producer boundary; no scheduler/boot I/O or installed producer is created here
 */
import { randomUUID } from "node:crypto";
import { HindsightCandidateErrorCodeSchema, HindsightCandidateGuardSchema, HindsightCandidatePlanSchema,
  HindsightCandidateProducerRefSchema, HindsightCandidateRequestSchema, HindsightCandidateResultSchema,
  type HindsightCandidateDispatch, type HindsightCandidateGuard, type HindsightCandidatePlan, type HindsightCandidateProducerRef,
  type HindsightCandidateRecord, type HindsightCandidateRequest, type HindsightCandidateResult, type HindsightCandidateErrorCode } from "@taki/shared/hindsight-candidate-domain";
import type { Database } from "../../db/sqlite.ts";
import { MemoryOperationRefusal } from "../operations/memory-operation-contract.ts";
import { claimDeferred } from "../operations/memory-operation-kind-backup.ts";
import { admitCandidateContinuation, admitCandidateDomain, assertCandidateAccess, type CandidateAccess } from "./hindsight-candidate-domain-admission.ts";
import { candidateDomainFail, candidateDomainHash, candidateRecoveryResult, existingCandidateRequest,
  readCandidateCommitted, readCandidateDomain, requireCandidateDomain } from "./hindsight-candidate-domain-read.ts";
import { recordCandidateDispatch, recordCandidateObservation, sealCandidateObservation, type CandidateObservation } from "./hindsight-candidate-domain-progress.ts";
import { refusalOf } from "./hindsight-candidate-refusal.ts";

export interface CandidateDriverContext {
  request: HindsightCandidateRequest;
  read(): HindsightCandidateRecord;
  dispatch<T>(dispatch: HindsightCandidateDispatch, effect: () => Promise<T>): Promise<{ dispatched: false } | { dispatched: true; value: T }>;
  observe(read: (original: HindsightCandidateRecord) => Promise<CandidateObservation>): Promise<HindsightCandidateRecord>;
}
export interface CandidateServiceInput {
  db: Database;
  currentGuard(): HindsightCandidateGuard;
  /** Synchronous lookup of an already validated source; public request fields are never accepted as the plan. */
  resolvePlan(request: Extract<HindsightCandidateRequest, { kind: "candidate.prepare" }>): HindsightCandidatePlan;
  driver(context: CandidateDriverContext): Promise<void>;
}
export interface CandidateOperationExecution {
  operationId: string; tryClaim(): boolean; checkpoint(producer: HindsightCandidateProducerRef): void;
}
export interface CandidateOperationSettlement {
  state: "completed" | "failed" | "cancelled" | "outcome_unknown";
  reason: "producer_refused" | "producer_incomplete" | "commitment_unknown" | "cancelled_before_claim" | null;
  errorCode: HindsightCandidateErrorCode | null;
  result: HindsightCandidateResult | null; producer?: HindsightCandidateProducerRef;
}

export function createHindsightCandidateService(input: CandidateServiceInput) {
  // Admission and persistAdmission are one synchronous owner transaction; this slot is not recovery state.
  let pending: { candidateId: string; plan: HindsightCandidatePlan } | null = null;
  return {
    existing: (request: HindsightCandidateRequest) => existingCandidateRequest(input.db, HindsightCandidateRequestSchema.parse(request)),
    read: (candidateId: string) => readCandidateDomain(input.db, candidateId),
    admit(request: HindsightCandidateRequest) {
      const parsed = HindsightCandidateRequestSchema.parse(request);
      if (parsed.kind !== "candidate.prepare") {
        const record = requireCandidateDomain(input.db, parsed.candidateId);
        if (record.planHash !== parsed.expectedPlanHash) candidateDomainFail("CONFLICT");
        return producer(record);
      }
      const plan = HindsightCandidatePlanSchema.parse(input.resolvePlan(parsed));
      if (candidateDomainHash("request", plan.request) !== candidateDomainHash("request", parsed)) candidateDomainFail("PROOF_MISMATCH");
      if (candidateDomainHash("guard", plan.guard) !== candidateDomainHash("guard", guard(input))) candidateDomainFail("STALE");
      pending = { candidateId: randomUUID(), plan };
      return HindsightCandidateProducerRefSchema.parse({ kind: "candidate", candidateId: pending.candidateId, phase: "admitted" });
    },
    persistAdmission(operation: { operationId: string; request: HindsightCandidateRequest; producer: HindsightCandidateProducerRef }) {
      const request = HindsightCandidateRequestSchema.parse(operation.request);
      if (request.kind !== "candidate.prepare") { admitCandidateContinuation(input.db, { operationId: operation.operationId, request, guard: guard(input) }); return; }
      const prepared = pending; pending = null;
      if (!prepared || prepared.candidateId !== operation.producer.candidateId
        || candidateDomainHash("request", prepared.plan.request) !== candidateDomainHash("request", request)) candidateDomainFail("CONFLICT");
      if (candidateDomainHash("guard", prepared.plan.guard) !== candidateDomainHash("guard", guard(input))) candidateDomainFail("STALE");
      admitCandidateDomain(input.db, { operationId: operation.operationId, ...prepared });
    },
    execute: (execution: CandidateOperationExecution) => executeCandidate(input, execution),
    observeBoot: (operationId: string) => observeHindsightCandidateOperation(input.db, operationId),
    cancel(operationId: string) {
      const row = input.db.prepare("SELECT state FROM memory_operations WHERE operation_id=:id").get({ id: operationId });
      if (row?.state !== "admitted") throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING");
    },
  };
}
export type HindsightCandidateService = ReturnType<typeof createHindsightCandidateService>;

async function executeCandidate(input: CandidateServiceInput, execution: CandidateOperationExecution): Promise<CandidateOperationSettlement> {
  if (!await claimDeferred(execution)) return { state: "cancelled", reason: "cancelled_before_claim", errorCode: null, result: null };
  const access = operationAccess(input.db, execution.operationId);
  try {
    const request = assertCandidateAccess(input.db, access, guard(input));
    execution.checkpoint(producer(requireCandidateDomain(input.db, access.candidateId)));
    const progress = driverContext(input, access, { request, checkpoint: execution.checkpoint });
    try {
      await input.driver(progress.context);
      if (!progress.observed()) return { state: "outcome_unknown", reason: "producer_incomplete", errorCode: null,
        result: candidateRecoveryResult(requireCandidateDomain(input.db, access.candidateId)) };
      const result = sealCandidateObservation(input.db, access, guard(input));
      return observedSettlement(request, result);
    } finally { progress.close(); }
  } catch (error) {
    const record = requireCandidateDomain(input.db, access.candidateId); const result = candidateRecoveryResult(record);
    const code = HindsightCandidateErrorCodeSchema.safeParse(error instanceof Error ? error.message : undefined);
    return { state: result.unknownActions.length ? "outcome_unknown" : "failed",
      reason: result.unknownActions.length ? "commitment_unknown" : "producer_refused",
      errorCode: code.success ? code.data : "HINDSIGHT_CANDIDATE_UNAVAILABLE", producer: producer(record),
      result: { ...result, refusal: refusalOf(error, ["unreadable", "restore"]).refusal } };
  }
}

function driverContext(input: CandidateServiceInput, access: CandidateAccess,
  callbacks: { request: HindsightCandidateRequest; checkpoint(ref: HindsightCandidateProducerRef): void }) {
  let active = true;
  const assertActive = () => { if (!active) candidateDomainFail("OPERATION_INACTIVE"); };
  const read = () => { assertActive(); return requireCandidateDomain(input.db, access.candidateId); };
  let observed = false;
  const context: CandidateDriverContext = { request: structuredClone(callbacks.request), read,
    async dispatch<T>(raw: HindsightCandidateDispatch, effect: () => Promise<T>) {
      assertActive();
      const dispatch = structuredClone(raw);
      if (!recordCandidateDispatch(input.db, access, { dispatch, guard: guard(input) })) return { dispatched: false };
      callbacks.checkpoint(producer(read()));
      assertCandidateAccess(input.db, access, guard(input));
      const value = await effect();
      assertActive();
      assertCandidateAccess(input.db, access, guard(input));
      return { dispatched: true, value };
    },
    async observe(observe) {
      assertActive();
      assertCandidateAccess(input.db, access, guard(input));
      const observation = structuredClone(await observe(read()));
      assertActive();
      const record = recordCandidateObservation(input.db, access, { observation, guard: guard(input) });
      observed = true; callbacks.checkpoint(producer(record)); return record;
    },
  };
  return { context, observed: () => observed, close: () => { active = false; } };
}

/** Available to boot even when no source resolver, current custody or installed candidate driver is composed. */
export function observeHindsightCandidateOperation(db: Database, operationId: string): CandidateOperationSettlement | null {
  const row = db.prepare(`SELECT o.result_json,o.result_hash,r.request_json,r.request_hash FROM hindsight_candidate_observations o
    JOIN hindsight_candidate_requests r ON r.operation_id=o.operation_id WHERE o.operation_id=:id`).get({ id: operationId });
  if (!row) return null;
  const result = HindsightCandidateResultSchema.parse(readCandidateCommitted(String(row.result_json), String(row.result_hash), "observation"));
  const request = HindsightCandidateRequestSchema.parse(readCandidateCommitted(String(row.request_json), String(row.request_hash), "request"));
  return observedSettlement(request, result);
}

function observedSettlement(request: HindsightCandidateRequest, result: HindsightCandidateResult): CandidateOperationSettlement {
  const completed = request.kind === "candidate.inspect" || result.phase === "baseline_verified";
  return { state: completed ? "completed" : "outcome_unknown", reason: completed ? null : result.unknownActions.length ? "commitment_unknown" : "producer_incomplete",
    errorCode: null, result, producer: { kind: "candidate", candidateId: result.candidateId, phase: result.phase } };
}
function operationAccess(db: Database, operationId: string): CandidateAccess {
  const row = db.prepare("SELECT candidate_id FROM hindsight_candidate_requests WHERE operation_id=:id").get({ id: operationId });
  if (!row) candidateDomainFail("NOT_FOUND");
  return { operationId, candidateId: String(row.candidate_id) };
}
function producer(record: HindsightCandidateRecord): HindsightCandidateProducerRef { return { kind: "candidate", candidateId: record.candidateId, phase: record.phase }; }
function guard(input: CandidateServiceInput) { return HindsightCandidateGuardSchema.parse(input.currentGuard()); }
