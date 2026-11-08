/**
 * INPUT:  real Memory Operation admission rows, fixed source plan and current operation-scoped guard
 * OUTPUT: atomic original candidate/request association or an explicit identity conflict
 * POS:    controlling-Core repository admission; joins the operation owner's transaction, never admits a Host effect
 */
import { HindsightCandidateGuardSchema, HindsightCandidatePlanSchema, HindsightCandidateRequestSchema,
  type HindsightCandidateGuard, type HindsightCandidatePlan, type HindsightCandidateRequest } from "@taki/shared/hindsight-candidate-domain";
import type { Database } from "../../db/sqlite.ts";
import { candidateDomainFail, candidateDomainHash, existingCandidateRequest, requireCandidateDomain, readCandidateCommitted } from "./hindsight-candidate-domain-read.ts";

export interface CandidateAccess { operationId: string; candidateId: string }
export function admitCandidateDomain(db: Database, input: CandidateAccess & { plan: HindsightCandidatePlan }) {
  const plan = HindsightCandidatePlanSchema.parse(input.plan);
  db.transaction(() => {
    if (existingCandidateRequest(db, plan.request)) candidateDomainFail("CONFLICT");
    const operation = admittedOperation(db, input, plan.request);
    db.prepare("INSERT INTO hindsight_candidate_records VALUES (:candidate,:operation,:hash,:plan,:at)")
      .run({ candidate: input.candidateId, operation: input.operationId, hash: candidateDomainHash("plan", plan),
        plan: JSON.stringify(plan), at: String(operation.created_at) });
    insertRequest(db, input, { request: plan.request, guard: plan.guard });
  });
  return requireCandidateDomain(db, input.candidateId);
}

export function admitCandidateContinuation(db: Database, input: { operationId: string; request: HindsightCandidateRequest; guard: HindsightCandidateGuard }) {
  const request = HindsightCandidateRequestSchema.parse(input.request);
  if (request.kind === "candidate.prepare") candidateDomainFail("CONFLICT");
  const access = { operationId: input.operationId, candidateId: request.candidateId };
  db.transaction(() => {
    const record = requireCandidateDomain(db, request.candidateId);
    if (existingCandidateRequest(db, request) || request.expectedPlanHash !== record.planHash) candidateDomainFail("CONFLICT");
    if (candidateDomainHash("host", input.guard.host) !== candidateDomainHash("host", record.plan.guard.host)) candidateDomainFail("STALE");
    admittedOperation(db, access, request);
    insertRequest(db, access, { request, guard: HindsightCandidateGuardSchema.parse(input.guard) });
  });
  return requireCandidateDomain(db, request.candidateId);
}

export function assertCandidateAccess(db: Database, access: CandidateAccess, current: HindsightCandidateGuard) {
  const row = db.prepare(`SELECT r.*,o.state,o.terminal_at FROM hindsight_candidate_requests r JOIN memory_operations o
    ON o.operation_id=r.operation_id WHERE r.operation_id=:operation AND r.candidate_id=:candidate`)
    .get({ operation: access.operationId, candidate: access.candidateId });
  if (!row || row.state !== "running" || row.terminal_at !== null) candidateDomainFail("OPERATION_INACTIVE");
  readCandidateCommitted(String(row.guard_json), String(row.guard_hash), "guard");
  if (row.guard_hash !== candidateDomainHash("guard", HindsightCandidateGuardSchema.parse(current))) candidateDomainFail("STALE");
  return HindsightCandidateRequestSchema.parse(readCandidateCommitted(String(row.request_json), String(row.request_hash), "request"));
}

function admittedOperation(db: Database, access: CandidateAccess, request: HindsightCandidateRequest) {
  const row = db.prepare("SELECT * FROM memory_operations WHERE operation_id=:id").get({ id: access.operationId });
  const producer: unknown = row?.producer_json ? JSON.parse(String(row.producer_json)) : null;
  if (!row || row.state !== "admitted" || row.terminal_at !== null || row.kind !== request.kind
    || candidateDomainHash("request", JSON.parse(String(row.request_json))) !== candidateDomainHash("request", request)
    || typeof producer !== "object" || producer === null || !("kind" in producer) || producer.kind !== "candidate"
    || !("candidateId" in producer) || producer.candidateId !== access.candidateId) candidateDomainFail("CONFLICT");
  return row;
}

function insertRequest(db: Database, access: CandidateAccess, input: { request: HindsightCandidateRequest; guard: HindsightCandidateGuard }) {
  db.prepare("INSERT INTO hindsight_candidate_requests VALUES (:request,:operation,:candidate,:hash,:json,:guardHash,:guard)")
    .run({ request: input.request.requestId, operation: access.operationId, candidate: access.candidateId,
      hash: candidateDomainHash("request", input.request), json: JSON.stringify(input.request),
      guardHash: candidateDomainHash("guard", input.guard), guard: JSON.stringify(input.guard) });
}
