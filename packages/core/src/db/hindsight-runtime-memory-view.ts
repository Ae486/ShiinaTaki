/**
 * INPUT:  a read-only D77 replica reader and its current application memory projections
 * OUTPUT: complete current Canonical memory rows for internal prompt/report staging
 * POS:    core/db — enumeration only; each row is revalidated by the application reader before policy admission
 */
import type { CanonicalMemoryRecord } from "@taki/shared";
import type { HindsightApplicationReplicaReader } from "./hindsight-application-replica-contract.ts";
import type { Database } from "./sqlite.ts";
import type { HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";

export function readHindsightRuntimeMemoryRecords(input: { db: Database; replica: HindsightApplicationReplicaReader }, scope: HindsightApplicationScope): CanonicalMemoryRecord[] {
  // SQL is only an index here. The reader verifies the active paired checkpoint,
  // native head, policy binding and original body hashes for every selected ID.
  const rows = input.db.prepare(`SELECT object_id FROM hindsight_application_replica_projections
    WHERE bank_id=:bank AND object_kind='memory_unit' AND operation='upsert' AND unit_state='valid'
    ORDER BY object_id`).all({ bank: scope.bankId });
  const result: CanonicalMemoryRecord[] = [];
  for (const row of rows) {
    const record = input.replica.record({ ...scope, memoryId: String(row.object_id) });
    if (record) result.push(record);
  }
  return result;
}
