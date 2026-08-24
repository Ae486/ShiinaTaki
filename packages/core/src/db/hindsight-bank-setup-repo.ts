/**
 * INPUT:  Core SQLite wrapper and validated per-Bank setup projections
 * OUTPUT: deterministic list/upsert/read methods for resumable Bank setup evidence
 * POS:    core/db — sanitized per-Bank state; remote Banks are never deleted or treated as authority
 */
import { HindsightBankSetupProjectionSchema, type HindsightBankSetupProjection } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export interface HindsightBankSetupRepo {
  list(): HindsightBankSetupProjection[];
  get(identity: string): HindsightBankSetupProjection | null;
  upsert(projection: HindsightBankSetupProjection): void;
  markAllPending(): void;
}

export function createHindsightBankSetupRepo(db: Database): HindsightBankSetupRepo {
  return {
    list: () => db.prepare("SELECT * FROM hindsight_bank_setup ORDER BY scope_kind,canonical_identity").all().map(parseRow),
    get: (identity) => { const row = db.prepare("SELECT * FROM hindsight_bank_setup WHERE canonical_identity=:identity").get({ identity }); return row ? parseRow(row) : null; },
    upsert: (projection) => { const value = HindsightBankSetupProjectionSchema.parse(projection); db.prepare(`INSERT INTO hindsight_bank_setup (canonical_identity,scope_kind,external_bank_id,template_revision,template_digest,status,operation_ids_json,last_verified_at,last_error_json,updated_at) VALUES (:identity,:scope,:external,:revision,:digest,:status,:operations,:verified,:error,:updated) ON CONFLICT(canonical_identity) DO UPDATE SET external_bank_id=excluded.external_bank_id,template_revision=excluded.template_revision,template_digest=excluded.template_digest,status=excluded.status,operation_ids_json=excluded.operation_ids_json,last_verified_at=excluded.last_verified_at,last_error_json=excluded.last_error_json,updated_at=excluded.updated_at`).run({ identity: value.canonicalIdentity, scope: value.scope, external: value.externalBankId, revision: value.templateRevision, digest: value.templateDigest, status: value.status, operations: JSON.stringify(value.operationIds), verified: value.lastVerifiedAt, error: value.lastError ? JSON.stringify(value.lastError) : null, updated: new Date().toISOString() }); },
    markAllPending: () => { db.prepare("UPDATE hindsight_bank_setup SET status='pending',operation_ids_json='[]',last_verified_at=NULL,last_error_json=NULL,updated_at=:updated").run({ updated: new Date().toISOString() }); },
  };
}

function parseRow(row: unknown): HindsightBankSetupProjection {
  const value = row as Record<string, unknown>;
  return HindsightBankSetupProjectionSchema.parse({ scope: value.scope_kind, canonicalIdentity: value.canonical_identity, externalBankId: value.external_bank_id, templateRevision: value.template_revision, templateDigest: value.template_digest, status: value.status, operationIds: JSON.parse(String(value.operation_ids_json)), lastVerifiedAt: value.last_verified_at, lastError: value.last_error_json ? JSON.parse(String(value.last_error_json)) : null });
}
