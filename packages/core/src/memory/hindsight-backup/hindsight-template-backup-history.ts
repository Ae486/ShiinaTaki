/**
 * INPUT:  stopped or transactionally stable Core SQLite and exact admitted template Bank identities
 * OUTPUT: complete verified enrollment/user/selection/default history and canonical commitments
 * POS:    copied-Core backup evidence; desired history is retained independently of the applied pointer
 */
import type { Database } from "../../db/sqlite.ts";
import { readTemplateEnrollment, readTemplateUser, readStoredTemplate } from "../hindsight/template-lifecycle/template-overlay-history.ts";
import { readAppliedTemplateSelection } from "../hindsight/template-lifecycle/template-overlay-store.ts";
import { TemplateBankIdentitySchema, type TemplateBankIdentity } from "../hindsight/template-lifecycle/template-overlay-schema.ts";
import { AppliedTemplateSelectionSchema } from "../hindsight/template-lifecycle/template-receipt.ts";
import { readTemplateDocument, templateIdentityKey } from "../hindsight/template-lifecycle/template-store-documents.ts";
import { TemplateDefaultsSchema, readTemplateDefaults } from "../hindsight/template-lifecycle/template-default-store.ts";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import { hindsightBackupHash } from "./hindsight-template-backup-integrity.ts";

export function hasHindsightTemplateHistory(db: Database): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='hindsight_template_enrollments'").get();
}
export function readHindsightTemplateBackupHistory(db: Database, raw: TemplateBankIdentity) {
  const identity = TemplateBankIdentitySchema.parse(raw); const key = templateIdentityKey(identity);
  const empty = { identity, enrollments: [], users: [], selections: [], currentSelectionRevision: 0 };
  if (!hasHindsightTemplateHistory(db)) return { ...empty, selected: null, historyHash: hindsightBackupHash("history", empty) };
  const enrolled = db.prepare("SELECT identity_key FROM hindsight_template_enrollments WHERE identity_key=:key").get({ key });
  const bases = db.prepare("SELECT revision FROM hindsight_template_bases WHERE identity_key=:key ORDER BY revision").all({ key });
  const userRows = db.prepare("SELECT revision FROM hindsight_template_users WHERE identity_key=:key ORDER BY revision").all({ key });
  const selectionRows = db.prepare("SELECT * FROM hindsight_template_selections WHERE identity_key=:key ORDER BY revision").all({ key });
  if (!enrolled) {
    if (bases.length || userRows.length || selectionRows.length
      || db.prepare("SELECT 1 FROM hindsight_template_applied WHERE identity_key=:key").get({ key })) invalid();
    return { ...empty, selected: null, historyHash: hindsightBackupHash("history", empty) };
  }
  if (!bases.length) invalid();
  const enrollments = bases.map((row, index) => {
    if (row.revision !== index + 1) invalid();
    const value = readTemplateEnrollment(db, identity, index + 1); if (!value) invalid(); return value;
  });
  for (let index = 1; index < enrollments.length; index++) {
    const before = enrollments[index - 1]!; const after = enrollments[index]!;
    if (!templateEqual(before.captures, after.captures.slice(0, before.captures.length))) invalid();
  }
  const users = userRows.map((row, index) => {
    if (row.revision !== index) invalid();
    const value = readTemplateUser(db, identity, index); if (!value) invalid(); return value;
  });
  // The existing reader verifies every selection against its original request, before-images,
  // catalog/user revisions, complete Native receipt, post-apply snapshot and ownership chain.
  const selected = readAppliedTemplateSelection(db, identity);
  const selections = selectionRows.map((row) => readTemplateDocument(row, AppliedTemplateSelectionSchema));
  const value = { identity, enrollments, users, selections, currentSelectionRevision: selected?.revision ?? 0 };
  return { ...value, selected, historyHash: hindsightBackupHash("history", value) };
}
export type HindsightTemplateBackupHistory = ReturnType<typeof readHindsightTemplateBackupHistory>;

export function readHindsightTemplateBackupDefaults(db: Database, providerLineage: string) {
  if (!hasHindsightTemplateHistory(db)) return defaultsResult({ providerLineage, currentRevision: 0, history: [], catalogs: [] });
  const current = readTemplateDefaults(db, providerLineage);
  const pointer = db.prepare("SELECT revision FROM hindsight_template_defaults WHERE provider_lineage=:lineage").get({ lineage: providerLineage });
  const rows = db.prepare("SELECT * FROM hindsight_template_default_history WHERE provider_lineage=:lineage ORDER BY revision").all({ lineage: providerLineage });
  const history = rows.map((row, index) => {
    const value = readTemplateDocument(row, TemplateDefaultsSchema);
    if (value.providerLineage !== providerLineage || value.revision !== index + 1 || value.revision !== row.revision) invalid();
    for (const scope of ["global", "character"] as const) {
      const revision = scope === "global" ? value.globalTemplateRevision : value.characterTemplateRevision;
      if (revision !== "none" && !readStoredTemplate(db, { revision, scope })) invalid();
    }
    for (const bank of value.banks) {
      const selection = readHindsightTemplateBackupHistory(db, bank.identity).selections[bank.selectionRevision - 1];
      const revision = bank.identity.scope === "global" ? value.globalTemplateRevision : value.characterTemplateRevision;
      if (!selection || selection.receipt.receipt_hash !== bank.receiptHash || selection.templateRevision !== revision) invalid();
    }
    return value;
  });
  if ((pointer?.revision ?? 0) !== history.length || (current?.revision ?? 0) !== history.length) invalid();
  const catalogs = db.prepare("SELECT template_revision,scope_kind FROM hindsight_template_catalog ORDER BY template_revision,scope_kind").all().map((row) => {
    if (row.scope_kind !== "global" && row.scope_kind !== "character") invalid();
    const value = readStoredTemplate(db, { revision: String(row.template_revision), scope: row.scope_kind });
    if (!value) invalid(); return value;
  });
  return defaultsResult({ providerLineage, currentRevision: current?.revision ?? 0, history, catalogs });
}
function defaultsResult(value: object) { return { value, defaultsHash: hindsightBackupHash("defaults", value) }; }
function invalid(): never { throw new Error("HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN"); }
