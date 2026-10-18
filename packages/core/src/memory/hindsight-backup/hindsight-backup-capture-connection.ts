/**
 * INPUT:  current or immutable copied Core connection/setup rows and the actually admitted capture runtime
 * OUTPUT: complete v2 connection revision/fingerprint/Bank inventory commitment
 * POS:    capture race guard; the historical v1 wire and connection fingerprint codec are unchanged
 */
import type { Database } from "../../db/sqlite.ts";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import type { HindsightBackupRuntimeIdentity } from "./hindsight-backup-identity.ts";

export function readHindsightCaptureConnection(db: Database, runtime: HindsightBackupRuntimeIdentity): string {
  const connection = db.prepare(`SELECT revision,config_fingerprint,phase,reviewed_deployment_mode
    FROM hindsight_connection_state WHERE singleton=1`).get();
  const rows = db.prepare("SELECT * FROM hindsight_bank_setup ORDER BY external_bank_id").all();
  const banks = runtime.banks();
  if (!connection || connection.phase !== "configured" || connection.config_fingerprint !== runtime.configFingerprint
    || connection.reviewed_deployment_mode !== null && connection.reviewed_deployment_mode !== runtime.deploymentMode
    || rows.length !== banks.length || new Set(banks.map((bank) => bank.bankId)).size !== banks.length) invalid();
  for (const row of rows) {
    const bank = banks.find((value) => value.bankId === row.external_bank_id);
    if (!bank || row.status !== "verified" || row.scope_kind !== bank.scope
      || row.canonical_identity !== (bank.scope === "global" ? "global" : "character:" + bank.characterId)) invalid();
  }
  // A pre-050 null reviewed mode remains unknown. The fingerprint is still exact; any later mode write changes this hash.
  return canonicalPayloadHash({ connection, banks: rows });
}
function invalid(): never { throw new Error("HINDSIGHT_BACKUP_READBACK_MISMATCH"); }
