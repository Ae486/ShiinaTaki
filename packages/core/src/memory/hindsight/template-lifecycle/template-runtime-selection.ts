/**
 * INPUT:  current Hindsight epoch, exact paired Bank namespaces and committed overlay selections
 * OUTPUT: exact-incarnation managed selection, or the preserved untracked legacy runtime branch
 * POS:    local runtime admission — enrollment makes complete canonical identity and stored evidence mandatory
 */
import { HindsightTemplateLabelsSchema, type HindsightBankSetupProjection, type TakiApplicationNamespace } from "@taki/shared";
import { readApplicationCheckpoint } from "../../../db/hindsight-application-replica-checkpoint.ts";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import type { Database } from "../../../db/sqlite.ts";
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
