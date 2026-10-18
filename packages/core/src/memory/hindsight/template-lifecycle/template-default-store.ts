/**
 * INPUT:  admitted lineage-wide built-in defaults and exact current Bank selection references
 * OUTPUT: immutable provisioning-default history with one CAS pointer, independent of per-Bank user revisions
 * POS:    058 storage adapter; B2 supplies complete runtime inventory and final publication guard
 */
import { z } from "zod";
import type { Database } from "../../../db/sqlite.ts";
import { TemplateBankIdentitySchema } from "./template-overlay-schema.ts";
import { readStoredTemplate } from "./template-overlay-history.ts";
import { readAppliedTemplateSelection } from "./template-overlay-store.ts";
import { assertSynchronousTemplateGuard, readTemplateDocument, templateDocument } from "./template-store-documents.ts";

export const TemplateDefaultsSchema = z.strictObject({
  providerLineage: z.uuid().transform((value) => value.toLowerCase()), revision: z.int().min(1),
  globalTemplateRevision: z.string().min(1).max(256), characterTemplateRevision: z.string().min(1).max(256),
  banks: z.array(z.strictObject({ identity: TemplateBankIdentitySchema, selectionRevision: z.int().min(1), receiptHash: z.string().regex(/^[a-f0-9]{64}$/) })).max(256),
}).refine((value) => value.banks.every((bank) => bank.identity.target.provider_lineage === value.providerLineage)
  && new Set(value.banks.map((bank) => bank.identity.canonicalIdentity)).size === value.banks.length);
export type TemplateDefaults = z.infer<typeof TemplateDefaultsSchema>;

export function readTemplateDefaults(db: Database, providerLineage: string): TemplateDefaults | null {
  const lineage = z.uuid().parse(providerLineage).toLowerCase();
  const row = db.prepare(`SELECT h.* FROM hindsight_template_defaults p JOIN hindsight_template_default_history h
    ON h.provider_lineage=p.provider_lineage AND h.revision=p.revision WHERE p.provider_lineage=:lineage`).get({ lineage });
  if (!row) return null;
  const value = readTemplateDocument(row, TemplateDefaultsSchema);
  if (value.providerLineage !== lineage || value.revision !== row.revision) throw new Error("HINDSIGHT_RESPONSE_INVALID");
  return value;
}

export function publishTemplateDefaults(db: Database, input: { value: TemplateDefaults; expectedRevision: number; assertCurrent: () => void }): void {
  const value = TemplateDefaultsSchema.parse(input.value);
  db.transaction(() => {
    const previous = readTemplateDefaults(db, value.providerLineage);
    if ((previous?.revision ?? 0) !== input.expectedRevision || value.revision !== input.expectedRevision + 1) conflict();
    for (const scope of ["global", "character"] as const) {
      const revision = scope === "global" ? value.globalTemplateRevision : value.characterTemplateRevision;
      if (revision !== "none" && !readStoredTemplate(db, { revision, scope })) conflict();
    }
    for (const bank of value.banks) {
      const selected = readAppliedTemplateSelection(db, bank.identity);
      const revision = bank.identity.scope === "global" ? value.globalTemplateRevision : value.characterTemplateRevision;
      if (selected?.revision !== bank.selectionRevision || selected.receipt.receipt_hash !== bank.receiptHash
        || selected.templateRevision !== revision) conflict();
    }
    const document = templateDocument(value);
    db.prepare("INSERT INTO hindsight_template_default_history VALUES(:lineage,:revision,:hash,:json)").run({
      lineage: value.providerLineage, revision: value.revision, ...document });
    if (!previous) db.prepare("INSERT INTO hindsight_template_defaults VALUES(:lineage,1)").run({ lineage: value.providerLineage });
    else if (db.prepare("UPDATE hindsight_template_defaults SET revision=:revision WHERE provider_lineage=:lineage AND revision=:expected")
      .run({ lineage: value.providerLineage, revision: value.revision, expected: input.expectedRevision }).changes !== 1) conflict();
    readTemplateDefaults(db, value.providerLineage);
    assertSynchronousTemplateGuard(input.assertCurrent);
  });
}
function conflict(): never { throw new Error("HINDSIGHT_STATE_CONFLICT"); }
