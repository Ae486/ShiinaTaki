/**
 * INPUT:  exact-incarnation enrollment and independently numbered catalog/user documents
 * OUTPUT: immutable stored before-images/user revisions, with expected-predecessor append checks
 * POS:    narrow Core 058 history adapter; storing desired history never publishes applied state
 */
import type { Database } from "../../../db/sqlite.ts";
import { TemplateEnrollmentSchema, verifyTemplateEnrollment, type TemplateEnrollment } from "./template-enrollment.ts";
import { TemplateCatalogEntrySchema, type TemplateCatalogEntry } from "./template-catalog.ts";
import { TemplateUserRevisionSchema, type TemplateBankIdentity, type TemplateUserRevision } from "./template-overlay-schema.ts";
import { assertStoredTemplateIdentity, readTemplateDocument, templateDocument, templateIdentityKey } from "./template-store-documents.ts";
import { templateEqual } from "./template-integrity.ts";

export function readTemplateEnrollment(db: Database, identity: TemplateBankIdentity, revision?: number): TemplateEnrollment | null {
  const key = templateIdentityKey(identity);
  const row = revision === undefined
    ? db.prepare("SELECT * FROM hindsight_template_bases WHERE identity_key=:key ORDER BY revision DESC LIMIT 1").get({ key })
    : db.prepare("SELECT * FROM hindsight_template_bases WHERE identity_key=:key AND revision=:revision").get({ key, revision });
  if (!row) return null;
  assertStoredTemplateIdentity(db, identity);
  const value = verifyTemplateEnrollment(readTemplateDocument(row, TemplateEnrollmentSchema));
  if (!templateEqual(identity, value.identity) || row.revision !== value.revision) invalid();
  return value;
}
export function appendTemplateEnrollment(db: Database, input: { enrollment: TemplateEnrollment; expectedRevision: number }): void {
  const value = verifyTemplateEnrollment(input.enrollment); const key = templateIdentityKey(value.identity);
  db.transaction(() => {
    const previous = readTemplateEnrollment(db, value.identity);
    if ((previous?.revision ?? 0) !== input.expectedRevision || value.revision !== input.expectedRevision + 1
      || previous && !templateEqual(previous.captures, value.captures.slice(0, previous.captures.length))) conflict();
    if (!previous) db.prepare(`INSERT INTO hindsight_template_enrollments
      (identity_key,provider_lineage,canonical_identity,scope_kind,bank_id,bank_generation,identity_json)
      VALUES(:key,:lineage,:canonical,:scope,:bank,:generation,:json)`).run({ key,
      lineage: value.identity.target.provider_lineage, canonical: value.identity.canonicalIdentity, scope: value.identity.scope,
      bank: value.identity.target.bank_id, generation: value.identity.target.bank_generation, json: JSON.stringify(value.identity) });
    const document = templateDocument(value);
    db.prepare("INSERT INTO hindsight_template_bases VALUES(:key,:revision,:hash,:json)").run({ key, revision: value.revision, ...document });
  });
}
export function readTemplateUser(db: Database, identity: TemplateBankIdentity, revision?: number): TemplateUserRevision | null {
  const key = assertStoredTemplateIdentity(db, identity);
  const row = revision === undefined
    ? db.prepare("SELECT * FROM hindsight_template_users WHERE identity_key=:key ORDER BY revision DESC LIMIT 1").get({ key })
    : db.prepare("SELECT * FROM hindsight_template_users WHERE identity_key=:key AND revision=:revision").get({ key, revision });
  if (!row) return null;
  const value = readTemplateDocument(row, TemplateUserRevisionSchema);
  if (value.revision !== row.revision) invalid();
  return value;
}
export function appendTemplateUser(db: Database, input: {
  identity: TemplateBankIdentity; user: TemplateUserRevision; expectedRevision: number | null;
}): void {
  const value = TemplateUserRevisionSchema.parse(input.user);
  db.transaction(() => {
    const key = assertStoredTemplateIdentity(db, input.identity); const previous = readTemplateUser(db, input.identity);
    if ((previous?.revision ?? null) !== input.expectedRevision || value.revision !== (input.expectedRevision === null ? 0 : input.expectedRevision + 1)) conflict();
    if (value.revision === 0 && [value.config, value.labels, value.models, value.directives].some((items) => items.length)) conflict();
    const document = templateDocument(value);
    db.prepare("INSERT INTO hindsight_template_users VALUES(:key,:revision,:hash,:json)").run({ key, revision: value.revision, ...document });
  });
}
export function readStoredTemplate(db: Database, input: { revision: string; scope: TemplateCatalogEntry["scope"] }): TemplateCatalogEntry | null {
  const row = db.prepare("SELECT * FROM hindsight_template_catalog WHERE template_revision=:revision AND scope_kind=:scope").get(input);
  if (!row) return null;
  const value = readTemplateDocument(row, TemplateCatalogEntrySchema);
  if (value.revision !== input.revision || value.scope !== input.scope) invalid();
  return value;
}
export function storeTemplateCatalogEntry(db: Database, entry: TemplateCatalogEntry): void {
  const value = TemplateCatalogEntrySchema.parse(entry); const document = templateDocument(value);
  db.transaction(() => {
    const existing = readStoredTemplate(db, { revision: value.revision, scope: value.scope });
    if (existing) { if (!templateEqual(existing, value)) conflict(); return; }
    db.prepare("INSERT INTO hindsight_template_catalog VALUES(:revision,:scope,:hash,:json)").run({
      revision: value.revision, scope: value.scope, ...document });
  });
}
function conflict(): never { throw new Error("HINDSIGHT_STATE_CONFLICT"); }
function invalid(): never { throw new Error("HINDSIGHT_RESPONSE_INVALID"); }
