/**
 * INPUT:  controlling-Core candidate rows and immutable source/request/dispatch/fact commitments
 * OUTPUT: validated original-candidate projection and local-only operation recovery assessment
 * POS:    candidate domain reads; no Host access, clock, retry, replacement or copied-Core construction
 */
import { HindsightCandidateDispatchSchema, HindsightCandidatePlanSchema, HindsightCandidateRecordSchema,
  HindsightCandidateResourceSchema, HindsightCandidateRestoreReceiptSchema,
  HindsightCandidateResultSchema, type HindsightCandidateRecord, type HindsightCandidateRequest } from "@taki/shared/hindsight-candidate-domain";
import { HindsightCandidatePhysicalIdentitySchema, HindsightCandidateVerificationSchema } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { transitionLocalHash } from "../transitions/transition-local-encoding.ts";

export function candidateDomainHash(kind: string, value: unknown) { return transitionLocalHash([`hindsight-candidate-${kind}.v1`, value]); }
export function candidateDomainFail(code: string): never { throw new Error(`HINDSIGHT_CANDIDATE_${code}`); }
export function readCandidateDomain(db: Database, candidateId: string): HindsightCandidateRecord | undefined {
  const row = db.prepare("SELECT * FROM hindsight_candidate_records WHERE candidate_id=:id").get({ id: candidateId });
  if (!row) return undefined;
  const plan = HindsightCandidatePlanSchema.parse(readCommitted(String(row.plan_json), String(row.plan_hash), "plan"));
  const dispatches = db.prepare("SELECT * FROM hindsight_candidate_dispatches WHERE candidate_id=:id ORDER BY action").all({ id: candidateId })
    .map((entry) => HindsightCandidateDispatchSchema.parse(readCommitted(String(entry.dispatch_json), String(entry.dispatch_hash), "dispatch")));
  const facts = new Map(db.prepare("SELECT * FROM hindsight_candidate_facts WHERE candidate_id=:id").all({ id: candidateId })
    .map((entry) => [String(entry.kind), readCommitted(String(entry.fact_json), String(entry.fact_hash), String(entry.kind))]));
  const resource = facts.has("resource") ? HindsightCandidateResourceSchema.parse(facts.get("resource")) : null;
  const restore = facts.has("restore") ? HindsightCandidateRestoreReceiptSchema.parse(facts.get("restore")) : null;
  const baseline = facts.get("verification") as { verification: unknown; identity: unknown } | undefined;
  const verification = baseline ? HindsightCandidateVerificationSchema.parse(baseline.verification) : null;
  const verificationIdentity = baseline ? HindsightCandidatePhysicalIdentitySchema.parse(baseline.identity) : null;
  const phase = verification ? "baseline_verified" : restore ? "restored_unverified"
    : dispatches.some((entry) => entry.action === "restore") ? "restore_dispatched" : resource ? "reserved" : "admitted";
  return HindsightCandidateRecordSchema.parse({ version: 1, candidateId, operationId: row.operation_id, planHash: row.plan_hash,
    plan, admittedAt: row.admitted_at, phase, dispatches, resource, restore, verification, verificationIdentity });
}

export function requireCandidateDomain(db: Database, candidateId: string): HindsightCandidateRecord {
  const value = readCandidateDomain(db, candidateId);
  if (!value) candidateDomainFail("NOT_FOUND");
  return value;
}

/** Request lookup precedes fresh admission/custody; replay cannot allocate a replacement candidate. */
export function existingCandidateRequest(db: Database, request: HindsightCandidateRequest): string | undefined {
  const row = db.prepare("SELECT request_hash,request_json,operation_id FROM hindsight_candidate_requests WHERE request_id=:id").get({ id: request.requestId });
  if (!row) return undefined;
  readCommitted(String(row.request_json), String(row.request_hash), "request");
  if (row.request_hash !== candidateDomainHash("request", request)) candidateDomainFail("CONFLICT");
  return String(row.operation_id);
}

export function candidateRecoveryResult(record: HindsightCandidateRecord) {
  const confirmed = { reserve: record.resource, restore: record.restore };
  return HindsightCandidateResultSchema.parse({ kind: "candidate", candidateId: record.candidateId, phase: record.phase,
    unknownActions: record.dispatches.filter((entry) => !confirmed[entry.action]).map((entry) => entry.action),
    verification: record.verification, refusal: null });
}

export function readCandidateCommitted(json: string, hash: string, domain: string): unknown {
  const value: unknown = JSON.parse(json);
  if (candidateDomainHash(domain, value) !== hash) candidateDomainFail("STORAGE_INVALID");
  return value;
}
const readCommitted = readCandidateCommitted;
