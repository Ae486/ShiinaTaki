/**
 * INPUT:  Core SQLite, stored desired revisions, reviewed preview, exact Native receipt and readback
 * OUTPUT: CAS-selected immutable overlay application history and receipt-proven resource ownership
 * POS:    Core 058 selection adapter; the template lifecycle owner supplies the all-Bank publication transaction
 */
import type { Database } from "../../../db/sqlite.ts";
import type { HindsightTemplateReceipt, HindsightTemplateSnapshot } from "@taki/shared";
import type { TemplateBankIdentity } from "./template-overlay-schema.ts";
import { type TemplatePreview, previewTemplateOverlay } from "./template-preview.ts";
import { AppliedTemplateSelectionSchema, deriveTemplateOwnership, verifyTemplateApplication,
  type AppliedTemplateSelection } from "./template-receipt.ts";
import { assertStoredTemplateIdentity, assertSynchronousTemplateGuard, readTemplateDocument,
  templateDocument } from "./template-store-documents.ts";
import { appendTemplateEnrollment, appendTemplateUser, readStoredTemplate, readTemplateEnrollment,
  readTemplateUser, storeTemplateCatalogEntry } from "./template-overlay-history.ts";
import { templateEqual } from "./template-integrity.ts";

export function createTemplateOverlayStore(db: Database) {
  return {
    enrollment: (identity: TemplateBankIdentity) => readTemplateEnrollment(db, identity),
    appendEnrollment: (input: Parameters<typeof appendTemplateEnrollment>[1]) => appendTemplateEnrollment(db, input),
    user: (identity: TemplateBankIdentity, revision?: number) => readTemplateUser(db, identity, revision),
    appendUser: (input: Parameters<typeof appendTemplateUser>[1]) => appendTemplateUser(db, input),
    storeCatalog: (entry: Parameters<typeof storeTemplateCatalogEntry>[1]) => storeTemplateCatalogEntry(db, entry),
    selected: (identity: TemplateBankIdentity) => readAppliedTemplateSelection(db, identity),
    publish: (input: PublishTemplateSelectionInput) => publishTemplateSelection(db, input),
  };
}
export interface PublishTemplateSelectionInput {
  identity: TemplateBankIdentity; expectedSelectionRevision: number;
  preview: TemplatePreview; receipt: HindsightTemplateReceipt; snapshot: HindsightTemplateSnapshot;
  committedAt: string; assertCurrent: () => void;
}

export function readAppliedTemplateSelection(db: Database, identity: TemplateBankIdentity): AppliedTemplateSelection | null {
  const key = assertStoredTemplateIdentity(db, identity);
  const pointer = db.prepare("SELECT revision FROM hindsight_template_applied WHERE identity_key=:key").get({ key });
  const rows = db.prepare("SELECT * FROM hindsight_template_selections WHERE identity_key=:key ORDER BY revision").all({ key });
  if (!pointer) { if (rows.length) invalid(); return null; }
  let previous: AppliedTemplateSelection | null = null;
  for (const row of rows) {
    const value = readTemplateDocument(row, AppliedTemplateSelectionSchema);
    if (value.revision !== (previous?.revision ?? 0) + 1 || value.revision !== row.revision
      || value.enrollmentRevision !== row.base_revision || value.userRevision !== row.user_revision
      || value.request.request_id !== row.request_id || value.request.request_hash !== row.request_hash
      || value.receipt.receipt_hash !== row.receipt_hash || !templateEqual(identity.target, value.request.target)) invalid();
    const expected = reconstructPreview(db, { identity, value, previous });
    if (!templateEqual(expected.request, value.request) || !templateEqual(expected.projection, value.projection)
      || !templateEqual(deriveTemplateOwnership(previous?.ownership ?? null, value.request), value.ownership)) invalid();
    verifyTemplateApplication({ preview: value, receipt: value.receipt, snapshot: value.snapshot });
    previous = value;
  }
  if (!previous || previous.revision !== pointer.revision) invalid();
  return previous;
}

function reconstructPreview(db: Database, input: {
  identity: TemplateBankIdentity;
  value: Pick<AppliedTemplateSelection, "templateRevision" | "userRevision" | "enrollmentRevision" | "request">;
  previous: AppliedTemplateSelection | null;
}): TemplatePreview {
  const { value, identity, previous } = input;
  const enrollment = readTemplateEnrollment(db, identity, value.enrollmentRevision);
  const user = readTemplateUser(db, identity, value.userRevision);
  const template = value.templateRevision === "none" ? null : readStoredTemplate(db, { revision: value.templateRevision, scope: identity.scope });
  if (!enrollment || !user || value.templateRevision !== "none" && !template) invalid();
  return previewTemplateOverlay({ enrollment, user, template, snapshot: value.request.expected_snapshot,
    requestId: value.request.request_id, previous, refresh: value.request.refresh, initialization: value.request.initialization,
    // The operation owned review/admission before its native dispatch. Reconstruction
    // validates the frozen result, and must not reapply a historical drift decision.
    reviewedDriftSnapshotHash: value.request.expected_snapshot.snapshot_hash });
}

function publishTemplateSelection(db: Database, input: PublishTemplateSelectionInput): AppliedTemplateSelection {
  let published: AppliedTemplateSelection | null = null;
  db.transaction(() => {
    const key = assertStoredTemplateIdentity(db, input.identity);
    const previous = readAppliedTemplateSelection(db, input.identity);
    if ((previous?.revision ?? 0) !== input.expectedSelectionRevision) conflict();
    const latest = readTemplateEnrollment(db, input.identity);
    if (latest?.revision !== input.preview.enrollmentRevision
      || readTemplateUser(db, input.identity)?.revision !== input.preview.userRevision) conflict();
    const preview = reconstructPreview(db, { identity: input.identity, value: input.preview, previous });
    if (!templateEqual(preview, input.preview)) invalid();
    verifyTemplateApplication({ preview, receipt: input.receipt, snapshot: input.snapshot });
    const value = AppliedTemplateSelectionSchema.parse({ revision: input.expectedSelectionRevision + 1,
      templateRevision: preview.templateRevision, userRevision: preview.userRevision, enrollmentRevision: preview.enrollmentRevision,
      request: preview.request, receipt: input.receipt, snapshot: input.snapshot, projection: preview.projection,
      ownership: deriveTemplateOwnership(previous?.ownership ?? null, preview.request), committedAt: input.committedAt });
    const document = templateDocument(value);
    db.prepare(`INSERT INTO hindsight_template_selections VALUES
      (:key,:revision,:base,:user,:request,:requestHash,:receiptHash,:hash,:json)`).run({ key, revision: value.revision,
      base: value.enrollmentRevision, user: value.userRevision, request: value.request.request_id,
      requestHash: value.request.request_hash, receiptHash: value.receipt.receipt_hash, ...document });
    if (!previous) db.prepare("INSERT INTO hindsight_template_applied VALUES(:key,1)").run({ key });
    else if (db.prepare("UPDATE hindsight_template_applied SET revision=:next WHERE identity_key=:key AND revision=:expected")
      .run({ key, next: value.revision, expected: input.expectedSelectionRevision }).changes !== 1) conflict();
    published = readAppliedTemplateSelection(db, input.identity);
    assertSynchronousTemplateGuard(input.assertCurrent);
  });
  if (!published) invalid();
  return published;
}
function conflict(): never { throw new Error("HINDSIGHT_STATE_CONFLICT"); }
function invalid(): never { throw new Error("HINDSIGHT_RESPONSE_INVALID"); }
