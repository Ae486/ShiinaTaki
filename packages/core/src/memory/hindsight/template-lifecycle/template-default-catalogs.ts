/**
 * INPUT:  the reviewed scope-default selection and immutable built-in/stored catalog history
 * OUTPUT: both scope definitions, including a scope with no currently provisioned Bank
 * POS:    default preview/admission companion — a missing Character never leaves its future default unpublished
 */
import type { MemoryTemplatePreviewParams } from "@taki/shared";
import type { Database } from "../../../db/sqlite.ts";
import { loadManagedTemplate, type TemplateCatalogEntry } from "./template-catalog.ts";
import { readStoredTemplate } from "./template-overlay-history.ts";

export function templateDefaultCatalogs(db: Database, target: MemoryTemplatePreviewParams["target"]): TemplateCatalogEntry[] {
  if (target.kind !== "defaults") return [];
  return (["global", "character"] as const).flatMap((scope) => {
    const revision = scope === "global" ? target.globalTemplateRevision : target.characterTemplateRevision;
    if (revision === "none") return [];
    return [readStoredTemplate(db, { revision, scope }) ?? loadManagedTemplate(revision, scope)];
  });
}
