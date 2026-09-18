/**
 * INPUT:  complete parent-intent values and SQLite byte rows
 * OUTPUT: independently hashed byte-preserving state reads and CAS replacement
 * POS:    core/db — private write-journal storage; no JSON1 depth limit or network work
 */
import type { Database, SqlRow } from "./sqlite.ts";
import { applicationCommandJsonBytes, applicationCommandJsonValue,
  type HindsightApplicationCommandKey } from "./hindsight-application-command-contract.ts";
import { applicationCommandKeyParams } from "./hindsight-application-command-storage.ts";
import { HindsightMemoryWriteStateSchema, hindsightMemoryWriteIntentHash,
  type HindsightMemoryWriteJob, type HindsightMemoryWriteState } from "./hindsight-memory-write-contract.ts";
import { hindsightApplicationBytesHash } from "../memory/hindsight/hindsight-application-integrity.ts";

export function readHindsightMemoryWrite(db: Database, key: HindsightApplicationCommandKey): HindsightMemoryWriteJob | undefined {
  const row = db.prepare(`SELECT * FROM hindsight_memory_write_intents
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND request_id=:request`).get(applicationCommandKeyParams(key));
  return row ? decodeHindsightMemoryWrite(row) : undefined;
}

export function decodeHindsightMemoryWrite(row: SqlRow): HindsightMemoryWriteJob {
  try {
    if (!(row.payload_bytes instanceof Uint8Array) || hindsightApplicationBytesHash(row.payload_bytes) !== row.payload_hash) invalid();
    const state = HindsightMemoryWriteStateSchema.parse(applicationCommandJsonValue(row.payload_bytes));
    const key = state.identity.key; const namespace = state.identity.namespace;
    if (key.authorityEpochId !== row.authority_epoch_id || key.bankId !== row.bank_id || key.requestId !== row.request_id
      || namespace.provider_lineage !== row.provider_lineage || namespace.bank_generation !== row.bank_generation
      || state.revision !== row.revision || state.nativeOperationId !== row.native_operation_id
      || state.intentHash !== row.intent_hash || state.intentHash !== hindsightMemoryWriteIntentHash(state.identity)
      || (state.terminal === null ? "pending" : "completed") !== row.state
      || !Number.isSafeInteger(row.sequence) || Number(row.sequence) < 1) invalid();
    return { ...state, sequence: Number(row.sequence) };
  } catch { return invalid(); }
}

export function insertHindsightMemoryWrite(db: Database, input: HindsightMemoryWriteState): HindsightMemoryWriteJob {
  const value = checkedBytes(input); const key = value.state.identity.key; const namespace = value.state.identity.namespace;
  db.prepare(`INSERT INTO hindsight_memory_write_intents
    (authority_epoch_id,bank_id,request_id,provider_lineage,bank_generation,intent_hash,native_operation_id,state,revision,payload_bytes,payload_hash)
    VALUES (:epoch,:bank,:request,:lineage,:generation,:intent,:native,:state,:revision,:bytes,:hash)`)
    .run({ ...applicationCommandKeyParams(key), lineage: namespace.provider_lineage, generation: namespace.bank_generation,
      intent: value.state.intentHash, native: value.state.nativeOperationId, ...value.params });
  return requireSaved(db, key);
}

export function replaceHindsightMemoryWrite(db: Database, input: { previous: HindsightMemoryWriteJob; next: HindsightMemoryWriteState }): HindsightMemoryWriteJob {
  const key = input.previous.identity.key; const value = checkedBytes(input.next);
  const result = db.prepare(`UPDATE hindsight_memory_write_intents SET
    state=:state,revision=:revision,payload_bytes=:bytes,payload_hash=:hash
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND request_id=:request AND revision=:expected`)
    .run({ ...applicationCommandKeyParams(key), ...value.params, expected: input.previous.revision });
  if (result.changes !== 1) throw new Error("MEMORY_REVISION_MISMATCH");
  return requireSaved(db, key);
}

function checkedBytes(input: HindsightMemoryWriteState) {
  const state = HindsightMemoryWriteStateSchema.parse(input);
  if (hindsightMemoryWriteIntentHash(state.identity) !== state.intentHash) invalid();
  const bytes = applicationCommandJsonBytes(state);
  return { state, params: { bytes, hash: hindsightApplicationBytesHash(bytes), revision: state.revision,
    state: state.terminal === null ? "pending" : "completed" } };
}
function requireSaved(db: Database, key: HindsightApplicationCommandKey): HindsightMemoryWriteJob {
  const result = readHindsightMemoryWrite(db, key); if (!result) invalid(); return result;
}
function invalid(): never { throw new Error("MEMORY_INTEGRITY_ERROR"); }
