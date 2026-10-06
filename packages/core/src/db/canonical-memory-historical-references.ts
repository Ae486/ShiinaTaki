/**
 * INPUT: verified transition tombstone edges and actual canonical record identities
 * OUTPUT: persistent historical references without fictitious supporting memory rows
 * POS: core/db — imported history only; ordinary addLineage still requires a real supporting unit
 */
import { MemoryTransitionHistoricalReferenceSchema, type MemoryTransitionHistoricalReference } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export function readCanonicalHistoricalReferences(db: Database, epochId: string): MemoryTransitionHistoricalReference[] {
  return db.prepare("SELECT * FROM canonical_memory_historical_references WHERE authority_epoch_id=:epoch ORDER BY bank_id,memory_id,source_memory_id")
    .all({ epoch: epochId }).map((row) => {
      const evidence = MemoryTransitionHistoricalReferenceSchema.parse(JSON.parse(String(row.evidence_json)));
      if (evidence.bankId !== row.bank_id || evidence.memoryId !== row.memory_id || evidence.sourceMemoryId !== row.source_memory_id) {
        throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
      }
      return evidence;
    });
}
export function insertCanonicalHistoricalReference(db: Database, epochId: string, evidence: MemoryTransitionHistoricalReference): void {
  const value = MemoryTransitionHistoricalReferenceSchema.parse(evidence);
  const identity = { epoch: epochId, bank: value.bankId, source: value.sourceMemoryId };
  if (db.prepare("SELECT 1 FROM canonical_memory_units WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:source").get(identity)) {
    throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
  db.prepare("INSERT OR IGNORE INTO canonical_memory_historical_identities VALUES(:epoch,:bank,:source)").run(identity);
  db.prepare("INSERT INTO canonical_memory_historical_references VALUES(:epoch,:bank,:memory,:source,:evidence)")
    .run({ ...identity, memory: value.memoryId, evidence: JSON.stringify(value) });
}
