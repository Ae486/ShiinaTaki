/**
 * INPUT:  frozen structured-transfer preparation and complete native result pages
 * OUTPUT: immutable validated import receipt with exact per-object mappings
 * POS:    core/db — D78 evidence persistence; never substitutes historical B2 counts
 */
import { HindsightCurrentImportEvidenceSchema, type HindsightCurrentImportEvidence,
  type HindsightCurrentTransferResult, type HindsightCurrentMappingPage } from "@taki/shared";
import { canonicalJson } from "../memory/legacy-migration/legacy-identities.ts";
import { verifyCurrentImport } from "../memory/hindsight/hindsight-current-import-proof.ts";
import { readHindsightCurrentPreparation } from "./hindsight-current-preparation-repo.ts";
import type { Database } from "./sqlite.ts";

export function saveHindsightCurrentImport(db: Database, input: {
  preparationId: string; result: HindsightCurrentTransferResult; pages: HindsightCurrentMappingPage[];
}): HindsightCurrentImportEvidence {
  let saved: HindsightCurrentImportEvidence | undefined;
  db.transaction(() => {
    const prepared = readHindsightCurrentPreparation(db, input.preparationId);
    const evidence = verifyCurrentImport({ prepared, result: input.result, pages: input.pages });
    const prior = readHindsightCurrentImport(db, input.preparationId);
    if (prior) {
      if (canonicalJson(prior) !== canonicalJson(evidence)) throw new Error("HINDSIGHT_CURRENT_IMPORT_CONFLICT");
      saved = prior; return;
    }
    db.prepare(`INSERT INTO hindsight_current_import_evidence (evidence_id,preparation_id,result_hash,evidence_json)
      VALUES (:id,:preparation,:hash,:json)`)
      .run({ id: evidence.evidenceId, preparation: evidence.preparationId, hash: evidence.result.result_hash, json: canonicalJson(evidence) });
    saved = evidence;
  });
  if (!saved) throw new Error("HINDSIGHT_CURRENT_IMPORT_MISSING");
  return saved;
}

export function readHindsightCurrentImport(db: Database, preparationId: string): HindsightCurrentImportEvidence | undefined {
  const row = db.prepare("SELECT * FROM hindsight_current_import_evidence WHERE preparation_id=:id").get({ id: preparationId });
  if (!row) return undefined;
  const evidence = HindsightCurrentImportEvidenceSchema.parse(JSON.parse(String(row.evidence_json)));
  const prepared = readHindsightCurrentPreparation(db, preparationId);
  const verified = verifyCurrentImport({ prepared, result: evidence.result, pages: evidence.pages });
  if (canonicalJson(verified) !== canonicalJson(evidence) || evidence.evidenceId !== row.evidence_id
    || evidence.preparationId !== row.preparation_id || evidence.result.result_hash !== row.result_hash) {
    throw new Error("HINDSIGHT_CURRENT_IMPORT_CORRUPT");
  }
  return verified;
}
