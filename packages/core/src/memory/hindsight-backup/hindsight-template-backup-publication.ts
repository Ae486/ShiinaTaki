/**
 * INPUT:  original B2 plan/publication and immutable selection/publication history in the copied Core
 * OUTPUT: historical runtime selection identity reconstructed at the actual publication's connection revision
 * POS:    backup evidence validation; today's applied pointer cannot validate an older publication commitment
 */
import type { Database } from "../../db/sqlite.ts";
import { readTemplatePublication, readTemplatePlan } from "../hindsight/template-lifecycle/template-execution-reads.ts";
import { templateEqual, templateHash } from "../hindsight/template-lifecycle/template-integrity.ts";
import type { TemplatePlan, TemplatePublication } from "../hindsight/template-lifecycle/template-plan-schema.ts";
import { templateProjectionDigest } from "../hindsight/template-lifecycle/template-projection.ts";
import { readHindsightTemplateBackupHistory } from "./hindsight-template-backup-history.ts";

export function assertHindsightTemplatePublicationIdentity(db: Database, input: {
  plan: TemplatePlan; publication: TemplatePublication;
}): void {
  const { plan, publication } = input;
  const preceding = readPrecedingPublications(db, publication.connectionRevision);
  const selections = plan.guard.banks.flatMap((entry) => {
    // The producer only includes verified setups. A just-provisioned Bank becomes
    // verified in this plan, so its published pointer is included as well.
    const own = publication.selections.find((value) => templateEqual(value.identity, entry.identity));
    if (!own && entry.setup.status !== "verified") return [];
    const prior = preceding.flatMap((value) => value.selections.filter((candidate) => templateEqual(candidate.identity, entry.identity))).at(-1);
    const reference = own ?? prior;
    if (!reference) return [];
    const selection = readHindsightTemplateBackupHistory(db, entry.identity).selections[reference.revision - 1];
    if (!selection || reference.receiptHash !== selection.receipt.receipt_hash) invalid();
    if (!own && (entry.setup.templateRevision !== selection.templateRevision
      || entry.setup.templateDigest !== templateProjectionDigest(selection.projection))) invalid();
    return [{ bankId: entry.identity.target.bank_id, namespace: entry.namespace, revision: selection.revision,
      receiptHash: selection.receipt.receipt_hash, templateRevision: selection.templateRevision }];
  });
  if (!selections.length) invalid();
  // Preserve B2's existing runtime-identity codec/order, including its historical
  // locale ordering. New backup domains use their separately specified byte order.
  selections.sort((left, right) => left.bankId.localeCompare(right.bankId));
  const identity = templateHash("definition", { record_kind: "core-template-runtime-selection.v1", epochId: plan.guard.epochId,
    selections, defaultsRevision: publication.defaultsRevision });
  if (identity !== publication.selectionIdentity) invalid();
}

function readPrecedingPublications(db: Database, connectionRevision: number): TemplatePublication[] {
  const values = db.prepare("SELECT plan_id FROM hindsight_template_publications ORDER BY plan_id").all().map((row) => {
    const publication = readTemplatePublication(db, String(row.plan_id));
    if (!publication) invalid();
    const plan = readTemplatePlan(db, publication.planId);
    if (publication.planHash !== plan.planHash || publication.epochId !== plan.guard.epochId
      || publication.connectionRevision !== plan.guard.connectionRevision + 1) invalid();
    return publication;
  }).filter((value) => value.connectionRevision < connectionRevision).sort((left, right) => left.connectionRevision - right.connectionRevision);
  const revisions = new Set<number>();
  for (const value of values) {
    if (revisions.has(value.connectionRevision)) invalid();
    revisions.add(value.connectionRevision);
  }
  return values;
}
function invalid(): never { throw new Error("HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN"); }
