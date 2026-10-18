/**
 * INPUT:  SQLite rows and strict Core overlay documents
 * OUTPUT: canonical document hashes and corruption-checked typed reads
 * POS:    private overlay persistence primitives; the SQLite wrapper remains the only database owner
 */
import type { z } from "zod";
import type { Database, SqlRow } from "../../../db/sqlite.ts";
import { TemplateBankIdentitySchema, type TemplateBankIdentity } from "./template-overlay-schema.ts";
import { templateEqual, templateHash } from "./template-integrity.ts";

export function templateIdentityKey(input: TemplateBankIdentity): string {
  return templateHash("definition", { record_kind: "core-template-identity.v1", identity: TemplateBankIdentitySchema.parse(input) });
}
export function templateDocument(value: unknown): { hash: string; json: string } {
  return { hash: templateHash("definition", { record_kind: "core-template-document.v1", document: value }), json: JSON.stringify(value) };
}
export function readTemplateDocument<T>(row: SqlRow, schema: z.ZodType<T>): T {
  const value = schema.parse(JSON.parse(String(row.document_json)));
  if (templateDocument(value).hash !== row.document_hash) throw new Error("HINDSIGHT_RESPONSE_INVALID");
  return value;
}
export function assertStoredTemplateIdentity(db: Database, input: TemplateBankIdentity): string {
  const key = templateIdentityKey(input);
  const row = db.prepare("SELECT * FROM hindsight_template_enrollments WHERE identity_key=:key").get({ key });
  if (!row) throw new Error("HINDSIGHT_TEMPLATE_CONFLICT");
  const identity = TemplateBankIdentitySchema.parse(JSON.parse(String(row.identity_json)));
  if (!templateEqual(identity, input) || row.provider_lineage !== identity.target.provider_lineage
    || row.canonical_identity !== identity.canonicalIdentity || row.scope_kind !== identity.scope
    || row.bank_id !== identity.target.bank_id || row.bank_generation !== identity.target.bank_generation) throw new Error("HINDSIGHT_RESPONSE_INVALID");
  return key;
}
export function assertSynchronousTemplateGuard(guard: () => void): void {
  const result: unknown = guard();
  if (result && typeof result === "object" && "then" in result) throw new Error("HINDSIGHT_STATE_CONFLICT");
}
