/**
 * INPUT:  Core Database wrapper plus canonical durable Approval rows and optimistic generations
 * OUTPUT: createApprovalStateRepo(db) — strict reads, atomic grant/revoke/reconcile/generation mutations
 * POS:    core/approval — sole SQL owner for Approval state; stores canonical metadata only
 */
import {
  ApprovalDurableDecisionSchema,
  canonicalStoredApprovalDurableDecisionBinding,
  Sha256HexSchema,
  type ApprovalDurableDecision,
} from "@taki/shared";
import { z } from "zod";
import type { Database, SqlStatement } from "../db/sqlite.ts";
import { storedApprovalBindingDigest } from "./approval-binding.ts";

export interface ApprovalStateSnapshot {
  approvalGeneration: number;
  governanceRegistryRevision: number;
  disclosureRevision: number;
  decisions: ApprovalDurableDecision[];
}

export interface ApprovalReconciliationPlan {
  governanceRegistryRevision: number;
  disclosureRevision: number;
  materiallyChanged: boolean;
  deleteDecisionIds?: readonly string[];
}

export class ApprovalGenerationConflictError extends Error {
  readonly currentApprovalGeneration: number;

  constructor(currentApprovalGeneration: number) {
    super(`approval generation conflict; current generation is ${currentApprovalGeneration}`);
    this.name = "ApprovalGenerationConflictError";
    this.currentApprovalGeneration = currentApprovalGeneration;
  }
}

export class ApprovalBindingCollisionError extends Error {
  constructor(bindingDigest: string, options?: ErrorOptions) {
    super(`approval binding digest collision for ${bindingDigest}`, options);
    this.name = "ApprovalBindingCollisionError";
  }
}

export class ApprovalBindingDigestMismatchError extends Error {
  constructor(bindingDigest: string) {
    super(`approval binding digest does not match canonical binding: ${bindingDigest}`);
    this.name = "ApprovalBindingDigestMismatchError";
  }
}

export interface ApprovalStateRepo {
  read(): ApprovalStateSnapshot;
  grant(decision: ApprovalDurableDecision, expectedApprovalGeneration: number): ApprovalStateSnapshot;
  revoke(decisionId: string, expectedApprovalGeneration: number): { revoked: boolean; snapshot: ApprovalStateSnapshot };
  advanceGeneration(expectedApprovalGeneration: number): ApprovalStateSnapshot;
  reconcile(plan: ApprovalReconciliationPlan): ApprovalStateSnapshot;
}

const StateRowSchema = z.strictObject({
  approval_generation: z.int().positive(),
  governance_registry_revision: z.int().positive(),
  disclosure_revision: z.int().positive(),
});
const HistoricalAuthorityColumnSchema = z.string().min(1).max(240);
const DecisionRowSchema = z.strictObject({
  decision_id: z.uuid(), binding_revision: z.int().positive(), binding_digest: Sha256HexSchema,
  capability_id: HistoricalAuthorityColumnSchema, owner_host_id: HistoricalAuthorityColumnSchema,
  subject_id: HistoricalAuthorityColumnSchema.nullable(), subject_revision: HistoricalAuthorityColumnSchema.nullable(),
  descriptor_revision: z.int().positive(), classifier_id: HistoricalAuthorityColumnSchema,
  classifier_revision: z.int().positive(), cell_key: HistoricalAuthorityColumnSchema,
  decision_scope_digest: Sha256HexSchema, disclosure_revision: z.int().positive(),
  provenance: z.enum(["operator", "legacy-reconfirmation"]),
  created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }),
}).refine((row) => (row.subject_id === null) === (row.subject_revision === null), "approval subject pair mismatch");

const READ_STATE = `SELECT approval_generation, governance_registry_revision, disclosure_revision
  FROM approval_state WHERE singleton_id = 1`;
const DECISION_COLUMNS = `decision_id, binding_revision, binding_digest, capability_id, owner_host_id,
  subject_id, subject_revision, descriptor_revision, classifier_id, classifier_revision, cell_key,
  decision_scope_digest, disclosure_revision, provenance, created_at, updated_at`;
const READ_DECISIONS = `SELECT ${DECISION_COLUMNS} FROM approval_decisions ORDER BY created_at, decision_id`;

export function createApprovalStateRepo(db: Database): ApprovalStateRepo {
  const statements = prepareStatements(db);
  return {
    read: () => readSnapshot(statements),
    grant(decision, expectedApprovalGeneration) {
      db.transaction(() => grantDecision(statements, decision, expectedApprovalGeneration));
      return readSnapshot(statements);
    },
    revoke(decisionId, expectedApprovalGeneration) {
      let revoked = false;
      db.transaction(() => {
        expectGeneration(statements, expectedApprovalGeneration);
        revoked = statements.deleteDecision.run({ decisionId }).changes > 0;
        if (revoked) advance(statements);
      });
      return { revoked, snapshot: readSnapshot(statements) };
    },
    advanceGeneration(expectedApprovalGeneration) {
      db.transaction(() => {
        expectGeneration(statements, expectedApprovalGeneration);
        advance(statements);
      });
      return readSnapshot(statements);
    },
    reconcile(plan) {
      db.transaction(() => reconcile(statements, plan));
      return readSnapshot(statements);
    },
  };
}

interface Statements {
  readState: SqlStatement;
  readDecisions: SqlStatement;
  readByDigest: SqlStatement;
  insertDecision: SqlStatement;
  deleteDecision: SqlStatement;
  deleteDecisionIds: SqlStatement;
  advance: SqlStatement;
  setRevisions: SqlStatement;
}

function prepareStatements(db: Database): Statements {
  return {
    readState: db.prepare(READ_STATE),
    readDecisions: db.prepare(READ_DECISIONS),
    readByDigest: db.prepare(`SELECT ${DECISION_COLUMNS} FROM approval_decisions WHERE binding_digest = :bindingDigest`),
    insertDecision: db.prepare(`INSERT INTO approval_decisions (
      decision_id,binding_revision,binding_digest,capability_id,owner_host_id,subject_id,subject_revision,
      descriptor_revision,classifier_id,classifier_revision,cell_key,decision_scope_digest,disclosure_revision,
      provenance,created_at,updated_at
    ) VALUES (
      :decisionId,:bindingRevision,:bindingDigest,:capabilityId,:ownerHostId,:subjectId,:subjectRevision,
      :descriptorRevision,:classifierId,:classifierRevision,:cellKey,:decisionScopeDigest,:disclosureRevision,
      :provenance,:createdAt,:updatedAt
    )`),
    deleteDecision: db.prepare("DELETE FROM approval_decisions WHERE decision_id = :decisionId"),
    deleteDecisionIds: db.prepare("DELETE FROM approval_decisions WHERE decision_id = :decisionId"),
    advance: db.prepare(`UPDATE approval_state SET approval_generation = approval_generation + 1,
      updated_at = :updatedAt WHERE singleton_id = 1`),
    setRevisions: db.prepare(`UPDATE approval_state SET governance_registry_revision = :governanceRegistryRevision,
      disclosure_revision = :disclosureRevision, updated_at = :updatedAt WHERE singleton_id = 1`),
  };
}

function readSnapshot(statements: Statements): ApprovalStateSnapshot {
  const state = readState(statements);
  return {
    approvalGeneration: state.approval_generation,
    governanceRegistryRevision: state.governance_registry_revision,
    disclosureRevision: state.disclosure_revision,
    decisions: statements.readDecisions.all().map(parseDecisionRow),
  };
}

function readState(statements: Statements) {
  const row = statements.readState.get();
  if (!row) throw new Error("approval state singleton is missing");
  return StateRowSchema.parse(row);
}

function parseDecisionRow(raw: unknown): ApprovalDurableDecision {
  const row = DecisionRowSchema.parse(raw);
  return ApprovalDurableDecisionSchema.parse({
    decisionId: row.decision_id,
    binding: {
      bindingRevision: row.binding_revision,
      identity: {
        capabilityId: row.capability_id,
        ownerHostId: row.owner_host_id,
        ...(row.subject_id === null ? {} : { subject: { subjectId: row.subject_id, revision: row.subject_revision } }),
      },
      descriptorRevision: row.descriptor_revision,
      classifierId: row.classifier_id,
      classifierRevision: row.classifier_revision,
      cellKey: row.cell_key,
      decisionScopeDigest: row.decision_scope_digest,
      disclosureRevision: row.disclosure_revision,
    },
    bindingDigest: row.binding_digest,
    provenance: row.provenance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function grantDecision(statements: Statements, decision: ApprovalDurableDecision, expected: number): void {
  expectGeneration(statements, expected);
  const canonical = ApprovalDurableDecisionSchema.parse(decision);
  const recomputedDigest = storedApprovalBindingDigest(canonical.binding);
  if (canonical.bindingDigest !== recomputedDigest) {
    throw new ApprovalBindingDigestMismatchError(canonical.bindingDigest);
  }
  const raw = statements.readByDigest.get({ bindingDigest: canonical.bindingDigest });
  if (raw) {
    if (sameCanonicalColumns(parseDecisionRow(raw), canonical)) return;
    throw new ApprovalBindingCollisionError(canonical.bindingDigest);
  }
  try {
    statements.insertDecision.run(decisionParams(canonical));
  } catch (error) {
    throw new ApprovalBindingCollisionError(canonical.bindingDigest, { cause: error });
  }
  advance(statements);
}

function sameCanonicalColumns(left: ApprovalDurableDecision, right: ApprovalDurableDecision): boolean {
  return canonicalStoredApprovalDurableDecisionBinding(left.binding)
    === canonicalStoredApprovalDurableDecisionBinding(right.binding);
}

function decisionParams(decision: ApprovalDurableDecision) {
  const subject = decision.binding.identity.subject;
  return {
    decisionId: decision.decisionId,
    bindingRevision: decision.binding.bindingRevision,
    bindingDigest: decision.bindingDigest,
    capabilityId: decision.binding.identity.capabilityId,
    ownerHostId: decision.binding.identity.ownerHostId,
    subjectId: subject?.subjectId ?? null,
    subjectRevision: subject?.revision ?? null,
    descriptorRevision: decision.binding.descriptorRevision,
    classifierId: decision.binding.classifierId,
    classifierRevision: decision.binding.classifierRevision,
    cellKey: decision.binding.cellKey,
    decisionScopeDigest: decision.binding.decisionScopeDigest,
    disclosureRevision: decision.binding.disclosureRevision,
    provenance: decision.provenance,
    createdAt: decision.createdAt,
    updatedAt: decision.updatedAt,
  };
}

function expectGeneration(statements: Statements, expected: number): void {
  const current = readState(statements).approval_generation;
  if (current !== expected) throw new ApprovalGenerationConflictError(current);
}

function advance(statements: Statements): void {
  statements.advance.run({ updatedAt: new Date().toISOString() });
}

function reconcile(statements: Statements, plan: ApprovalReconciliationPlan): void {
  const current = readState(statements);
  if (current.governance_registry_revision > plan.governanceRegistryRevision) {
    throw new Error(`database governance registry ${current.governance_registry_revision} is newer than code ${plan.governanceRegistryRevision}`);
  }
  if (current.disclosure_revision > plan.disclosureRevision) {
    throw new Error(`database Approval disclosure ${current.disclosure_revision} is newer than code ${plan.disclosureRevision}`);
  }
  const ids = [...new Set(plan.deleteDecisionIds ?? [])];
  let deleted = false;
  for (const decisionId of ids) deleted = statements.deleteDecisionIds.run({ decisionId }).changes > 0 || deleted;
  const revisionsChanged = current.governance_registry_revision !== plan.governanceRegistryRevision
    || current.disclosure_revision !== plan.disclosureRevision;
  if (revisionsChanged) statements.setRevisions.run({
    governanceRegistryRevision: plan.governanceRegistryRevision,
    disclosureRevision: plan.disclosureRevision,
    updatedAt: new Date().toISOString(),
  });
  if (plan.materiallyChanged || deleted) advance(statements);
}
