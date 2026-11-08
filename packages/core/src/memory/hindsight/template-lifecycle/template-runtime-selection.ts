/**
 * INPUT:  current Hindsight epoch, exact paired Bank namespaces and committed overlay selections
 * OUTPUT: fully verified selections and a separate current-row identity, preserving untracked legacy Banks
 * POS:    template owner — full proof at consuming/binding boundaries; ordinary guards inspect current metadata/projection
 */
import { HindsightTemplateLabelsSchema, type HindsightBankSetupProjection, type TakiApplicationNamespace } from "@taki/shared";
import { readApplicationCheckpoint } from "../../../db/hindsight-application-replica-checkpoint.ts";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import type { Database, SqlRow } from "../../../db/sqlite.ts";
import { TemplateBankIdentitySchema } from "./template-overlay-schema.ts";
import { readTemplateEnrollment } from "./template-overlay-history.ts";
import { readAppliedTemplateSelection } from "./template-overlay-store.ts";
import { assertStoredTemplateIdentity } from "./template-store-documents.ts";
import { hasTemplateExecutionStorage } from "./template-execution-reads.ts";
import { readTemplateDefaults } from "./template-default-store.ts";
import { templateHash } from "./template-integrity.ts";
import { templateProjectionDigest, type TemplateProjection } from "./template-projection.ts";

export function readRuntimeTemplateSelection(db: Database, input: { bankId: string; namespace: TakiApplicationNamespace }) {
  if (!hasTemplateExecutionStorage(db)) return null;
  // Legacy Banks need no managed canonical identity. Only this exact incarnation's
  // enrollment enters the strict path; neither a matching Bank ID nor old v1 equality grants ownership.
  const enrollment = db.prepare(`SELECT identity_key FROM hindsight_template_enrollments
    WHERE provider_lineage=:lineage AND bank_id=:bank AND bank_generation=:generation`).get({
    lineage: input.namespace.provider_lineage, bank: input.bankId, generation: input.namespace.bank_generation });
  if (!enrollment) return null;
  const setup = createHindsightBankSetupRepo(db).list().find((row) => row.externalBankId === input.bankId);
  if (!setup) throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
  const identity = TemplateBankIdentitySchema.parse({ scope: setup.scope, canonicalIdentity: setup.canonicalIdentity,
    target: { bank_id: input.bankId, provider_lineage: input.namespace.provider_lineage, bank_generation: input.namespace.bank_generation } });
  if (assertStoredTemplateIdentity(db, identity) !== enrollment.identity_key || !readTemplateEnrollment(db, identity)) {
    throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
  }
  const selected = readAppliedTemplateSelection(db, identity);
  if (selected && (setup.templateRevision !== selected.templateRevision || setup.templateDigest !== templateProjectionDigest(selected.projection))) {
    throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
  }
  return selected;
}

export function readTemplateSelectionIdentity(db: Database, epochId: string): string | null {
  if (!hasTemplateExecutionStorage(db)) return null;
  const selections = [];
  let lineage: string | null = null;
  for (const row of createHindsightBankSetupRepo(db).list()) {
    if (row.status !== "verified") continue;
    const checkpoint = readApplicationCheckpoint(db, row.externalBankId);
    if (!checkpoint || checkpoint.authorityEpochId !== epochId || checkpoint.bankDeleted) {
      if (row.templateRevision !== "taki-bank-v1") throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
      continue;
    }
    const selected = readRuntimeTemplateSelection(db, { bankId: row.externalBankId, namespace: checkpoint.namespace });
    if (!selected) continue;
    if (lineage !== null && lineage !== checkpoint.namespace.provider_lineage) throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
    lineage = checkpoint.namespace.provider_lineage;
    selections.push({ bankId: row.externalBankId, namespace: checkpoint.namespace, revision: selected.revision,
      receiptHash: selected.receipt.receipt_hash, templateRevision: selected.templateRevision });
  }
  if (!selections.length || !lineage) return null;
  selections.sort((left, right) => left.bankId.localeCompare(right.bankId));
  return templateHash("definition", { record_kind: "core-template-runtime-selection.v1", epochId, selections,
    defaultsRevision: readTemplateDefaults(db, lineage)?.revision ?? 0 });
}

/** Current identity only: no historical documents, preview reconstruction or remembered validation verdict. */
export function readCurrentRuntimeTemplateIdentity(db: Database, epochId: string): string | null {
  if (!hasTemplateExecutionStorage(db)) return null;
  const selections = [];
  let lineage: string | null = null;
  for (const row of createHindsightBankSetupRepo(db).list()) {
    if (row.status !== "verified") continue;
    const checkpoint = readApplicationCheckpoint(db, row.externalBankId);
    if (!checkpoint || checkpoint.authorityEpochId !== epochId || checkpoint.bankDeleted) {
      if (row.templateRevision !== "taki-bank-v1") throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
      continue;
    }
    const selected = readCurrentTemplateSelection(db, { setup: row, namespace: checkpoint.namespace });
    if (!selected) continue;
    if (lineage !== null && lineage !== checkpoint.namespace.provider_lineage) throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
    lineage = checkpoint.namespace.provider_lineage;
    selections.push({ bankId: row.externalBankId, namespace: checkpoint.namespace, revision: selected.revision,
      receiptHash: selected.receiptHash, templateRevision: selected.templateRevision });
  }
  if (!selections.length || !lineage) return null;
  selections.sort((left, right) => left.bankId.localeCompare(right.bankId));
  return templateHash("definition", { record_kind: "core-template-runtime-selection.v1", epochId, selections,
    defaultsRevision: readCurrentDefaultsRevision(db, lineage) });
}

function readCurrentTemplateSelection(db: Database, input: { setup: HindsightBankSetupProjection; namespace: TakiApplicationNamespace }) {
  const { setup, namespace } = input;
  const enrollment = db.prepare(`SELECT identity_key FROM hindsight_template_enrollments
    WHERE provider_lineage=:lineage AND bank_id=:bank AND bank_generation=:generation`).get({
    lineage: namespace.provider_lineage, bank: setup.externalBankId, generation: namespace.bank_generation });
  if (!enrollment) return null;
  const identity = TemplateBankIdentitySchema.parse({ scope: setup.scope, canonicalIdentity: setup.canonicalIdentity,
    target: { bank_id: setup.externalBankId, provider_lineage: namespace.provider_lineage, bank_generation: namespace.bank_generation } });
  const key = assertStoredTemplateIdentity(db, identity);
  if (key !== enrollment.identity_key || !db.prepare(`SELECT revision FROM hindsight_template_bases
    WHERE identity_key=:key ORDER BY revision DESC LIMIT 1`).get({ key })) throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
  const current = readCurrentSelectionRow(db, key);
  if (!current) return null;
  if (current.revision !== current.latest_revision || current.revision !== current.document_revision
    || current.receipt_hash !== current.document_receipt_hash || current.request_id !== current.document_request_id
    || current.request_hash !== current.document_request_hash || current.base_revision !== current.document_base_revision
    || current.user_revision !== current.document_user_revision || current.has_base !== 1 || current.has_user !== 1) {
    throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
  }
  // 058 has no independent projection-digest column. Consume only this current projection to
  // preserve setup-digest drift detection, without validating its enclosing history/receipt/snapshot.
  if (setup.templateRevision !== current.template_revision
    || setup.templateDigest !== templateProjectionDigest(JSON.parse(String(current.projection_json)))) {
    throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED");
  }
  return { revision: current.revision, receiptHash: current.receipt_hash, templateRevision: current.template_revision };
}

function readCurrentSelectionRow(db: Database, key: string): SqlRow | null {
  const pointer = db.prepare("SELECT revision FROM hindsight_template_applied WHERE identity_key=:key").get({ key });
  const latest = db.prepare(`SELECT revision FROM hindsight_template_selections
    WHERE identity_key=:key ORDER BY revision DESC LIMIT 1`).get({ key });
  if (!pointer) {
    if (latest) throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
    return null;
  }
  const row = db.prepare(`SELECT revision,base_revision,user_revision,request_id,request_hash,receipt_hash,
    json_extract(document_json,'$.revision') AS document_revision,
    json_extract(document_json,'$.enrollmentRevision') AS document_base_revision,
    json_extract(document_json,'$.userRevision') AS document_user_revision,
    json_extract(document_json,'$.request.request_id') AS document_request_id,
    json_extract(document_json,'$.request.request_hash') AS document_request_hash,
    json_extract(document_json,'$.receipt.receipt_hash') AS document_receipt_hash,
    json_extract(document_json,'$.templateRevision') AS template_revision,
    json_extract(document_json,'$.projection') AS projection_json,
    EXISTS(SELECT 1 FROM hindsight_template_bases WHERE identity_key=:key AND revision=s.base_revision) AS has_base,
    EXISTS(SELECT 1 FROM hindsight_template_users WHERE identity_key=:key AND revision=s.user_revision) AS has_user
    FROM hindsight_template_selections s WHERE identity_key=:key AND revision=:revision`).get({ key, revision: Number(pointer.revision) });
  if (!row) throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
  return { ...row, latest_revision: latest?.revision ?? null };
}

function readCurrentDefaultsRevision(db: Database, lineage: string) {
  const row = db.prepare(`SELECT p.revision,h.revision AS history_revision,
    json_extract(h.document_json,'$.revision') AS document_revision,
    json_extract(h.document_json,'$.providerLineage') AS document_lineage
    FROM hindsight_template_defaults p LEFT JOIN hindsight_template_default_history h
    ON h.provider_lineage=p.provider_lineage AND h.revision=p.revision WHERE p.provider_lineage=:lineage`).get({ lineage });
  if (!row) return 0;
  if (row.revision !== row.history_revision || row.revision !== row.document_revision || lineage !== row.document_lineage) {
    throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
  }
  return row.revision;
}

export function readSelectedTemplateLabelGroup(db: Database, input: { bankId: string; namespace: TakiApplicationNamespace }) {
  const selected = readRuntimeTemplateSelection(db, input);
  return selected ? templateProjectionLabelGroup(selected.projection) : null;
}

export function templateProjectionLabelGroup(projection: TemplateProjection) {
  const config = projection.config.find((entry) => entry.key === "entity_labels");
  if (!config) return null;
  const parsed = HindsightTemplateLabelsSchema.safeParse(config.stored.kind === "value" ? config.stored.value : config.inherited);
  if (!parsed.success || parsed.data === null) return null;
  const groups = Array.isArray(parsed.data) ? parsed.data : parsed.data.attributes;
  return groups.find((group) => group.key === "taki-layer") ?? null;
}

/** A managed selection owns its independent revision; the connection knob continues to describe legacy v1 Banks. */
export function assertRuntimeTemplateBanks(db: Database, input: { epochId: string; rows: HindsightBankSetupProjection[]; legacyRevision: string }): void {
  for (const row of input.rows) {
    const checkpoint = readApplicationCheckpoint(db, row.externalBankId);
    const selected = checkpoint && checkpoint.authorityEpochId === input.epochId && !checkpoint.bankDeleted
      ? readRuntimeTemplateSelection(db, { bankId: row.externalBankId, namespace: checkpoint.namespace }) : null;
    if (!selected && row.templateRevision !== input.legacyRevision) throw new Error("HINDSIGHT_TEMPLATE_CONFLICT");
  }
}
