/**
 * INPUT:  versioned canonical preparation and parsed native result/snapshot confirmation
 * OUTPUT: transactional immutable evidence persistence, exact binding lookup, and validated reopen
 * POS:    core/db — durable Taki migration provenance; independent of disposable replica rows and B2/Pending ledgers
 */
import {
  HindsightPreparedSourceSchema, HindsightSourceBindingKeySchema, HindsightSourceObjectBindingSchema,
  type HindsightPreparedSource, type HindsightSourceBindingKey, type HindsightSourceConfirmation,
  type HindsightSourceObjectBinding,
} from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import { canonicalJson } from "../memory/legacy-migration/legacy-identities.ts";
import { assertPreparedHindsightSource } from "../memory/hindsight/hindsight-source-preparation.ts";
import { confirmHindsightSourceBindings, hindsightSourceBindingId } from "../memory/hindsight/hindsight-source-binding-proof.ts";
import { readHindsightLocalBankBinding } from "./hindsight-local-bank-binding.ts";

export interface HindsightSourceEvidenceRepo {
  savePrepared(prepared: HindsightPreparedSource): HindsightPreparedSource;
  getPrepared(evidenceId: string): HindsightPreparedSource | undefined;
  confirm(input: HindsightSourceConfirmation): HindsightSourceObjectBinding[];
  binding(key: HindsightSourceBindingKey): HindsightSourceObjectBinding | undefined;
}

export function createHindsightSourceEvidenceRepo(db: Database): HindsightSourceEvidenceRepo {
  return {
    savePrepared: (raw) => {
      const prepared = assertPreparedHindsightSource(raw);
      db.transaction(() => {
        const existing = readPrepared(db, prepared.evidenceId);
        if (existing) {
          if (canonicalJson(existing) !== canonicalJson(prepared)) throw new Error("HINDSIGHT_SOURCE_EVIDENCE_INVALID");
        } else insertPrepared(db, prepared);
      });
      return prepared;
    },
    getPrepared: (evidenceId) => readPrepared(db, evidenceId),
    binding: (key) => readBinding(db, key),
    confirm: (input) => {
      let bindings: HindsightSourceObjectBinding[] = [];
      db.transaction(() => {
        const prepared = readPrepared(db, input.evidenceId);
        if (!prepared) throw new Error("HINDSIGHT_SOURCE_EVIDENCE_MISSING");
        const bank = readHindsightLocalBankBinding(db, { localEpochId: prepared.source.authorityEpochId,
          sourceBankId: prepared.source.bankId });
        bindings = confirmHindsightSourceBindings(prepared, input, bank).map((binding) => saveBinding(db, binding));
      });
      return bindings;
    },
  };
}

function insertPrepared(db: Database, value: HindsightPreparedSource): void {
  db.prepare(`INSERT INTO hindsight_source_evidence
    (evidence_id,schema_version,local_epoch_id,bank_id,document_id,source_revision,source_hash,retained_text_hash,
     source_json,native_item_json,native_item_hash,unit_count,gap_count,gaps_json)
    VALUES (:id,:version,:epoch,:bank,:document,:revision,:hash,:textHash,:source,:item,:itemHash,:units,:gapCount,:gaps)`)
    .run({ id: value.evidenceId, version: value.schemaVersion, epoch: value.source.authorityEpochId,
      bank: value.source.bankId, document: value.source.documentId, revision: value.source.revision,
      hash: value.sourceHash, textHash: value.retainedTextHash, source: canonicalJson(value.source),
      item: value.nativeItem === null ? null : canonicalJson(value.nativeItem), itemHash: value.nativeItemHash,
      units: value.units.length, gapCount: value.gapCount, gaps: canonicalJson(value.gaps) });
  for (const unit of value.units) {
    db.prepare(`INSERT INTO hindsight_source_unit_evidence (evidence_id,memory_id,unit_revision,record_hash,record_json)
      VALUES (:id,:memory,:revision,:hash,:record)`).run({ id: value.evidenceId, memory: unit.record.unit.memoryId,
      revision: unit.record.unit.revision, hash: unit.recordHash, record: canonicalJson(unit.record) });
  }
}

function readPrepared(db: Database, evidenceId: string): HindsightPreparedSource | undefined {
  const row = db.prepare("SELECT * FROM hindsight_source_evidence WHERE evidence_id=:id").get({ id: evidenceId });
  if (!row) return undefined;
  try {
    const units = db.prepare("SELECT * FROM hindsight_source_unit_evidence WHERE evidence_id=:id ORDER BY memory_id")
      .all({ id: evidenceId }).sort((a, b) => String(a.memory_id) < String(b.memory_id) ? -1 : String(a.memory_id) > String(b.memory_id) ? 1 : 0);
    const parsed = HindsightPreparedSourceSchema.parse({ schemaVersion: row.schema_version, evidenceId: row.evidence_id,
      source: JSON.parse(String(row.source_json)), sourceHash: row.source_hash, retainedTextHash: row.retained_text_hash,
      nativeItem: row.native_item_json === null ? null : JSON.parse(String(row.native_item_json)),
      nativeItemHash: row.native_item_hash, gapCount: row.gap_count, gaps: JSON.parse(String(row.gaps_json)),
      units: units.map((unit) => ({ recordHash: unit.record_hash, record: JSON.parse(String(unit.record_json)) })) });
    if (row.local_epoch_id !== parsed.source.authorityEpochId || row.bank_id !== parsed.source.bankId
      || row.document_id !== parsed.source.documentId || row.source_revision !== parsed.source.revision
      || row.unit_count !== parsed.units.length || units.some((unit, index) => unit.memory_id !== parsed.units[index]?.record.unit.memoryId
        || unit.unit_revision !== parsed.units[index]?.record.unit.revision)) throw new Error();
    return assertPreparedHindsightSource(parsed);
  } catch { throw new Error("HINDSIGHT_SOURCE_EVIDENCE_INVALID"); }
}

function saveBinding(db: Database, binding: HindsightSourceObjectBinding): HindsightSourceObjectBinding {
  const key = { providerLineageId: binding.providerLineageId, bankGeneration: binding.bankGeneration, bankId: binding.bankId,
    objectKind: binding.objectKind, objectId: binding.objectId, objectRevision: binding.objectRevision };
  const existing = readBinding(db, key);
  if (existing) {
    // Reobserving the same immutable native fact in another verified snapshot or
    // journal is replay, not rebinding. Preserve the first observation receipt;
    // every source, operation, result and exact object field must still agree.
    const replay = { ...binding, observationKind: existing.observationKind, observationId: existing.observationId,
      observedCursor: existing.observedCursor };
    if (existing.bindingId !== hindsightSourceBindingId(replay)) throw new Error("HINDSIGHT_SOURCE_BINDING_CONFLICT");
    return existing;
  }
  try {
    db.prepare(`INSERT INTO hindsight_source_object_bindings
      (binding_id,schema_version,evidence_id,source_bank_id,bank_scope_json,source_document_id,source_memory_id,provider_lineage_id,bank_generation,
       bank_id,object_kind,object_id,object_revision,native_payload_hash,operation_id,request_hash,result_hash,
       native_receipt_hash,native_through_cursor,observation_kind,observation_id,observed_cursor,confirmed_at)
      VALUES (:bindingId,:schemaVersion,:evidenceId,:sourceBankId,:bankScopeJson,:sourceDocumentId,:sourceMemoryId,:providerLineageId,:bankGeneration,
       :bankId,:objectKind,:objectId,:objectRevision,:nativePayloadHash,:operationId,:requestHash,:resultHash,
       :nativeReceiptHash,:nativeThroughCursor,:observationKind,:observationId,:observedCursor,:confirmedAt)`)
      .run(bindingRow(binding));
  } catch { throw new Error("HINDSIGHT_SOURCE_BINDING_CONFLICT"); }
  return binding;
}

function bindingRow(binding: HindsightSourceObjectBinding): SqlRow {
  const { bankScope, ...columns } = binding;
  return { ...columns, bankScopeJson: canonicalJson(bankScope) };
}

function readBinding(db: Database, raw: HindsightSourceBindingKey): HindsightSourceObjectBinding | undefined {
  const key = HindsightSourceBindingKeySchema.safeParse(raw);
  if (!key.success) throw new Error("HINDSIGHT_SOURCE_BINDING_INVALID");
  const row = db.prepare(`SELECT * FROM hindsight_source_object_bindings WHERE provider_lineage_id=:providerLineageId
    AND bank_generation=:bankGeneration AND bank_id=:bankId AND object_kind=:objectKind AND object_id=:objectId
    AND object_revision=:objectRevision`).get(key.data);
  if (!row) return undefined;
  return parseBinding(row);
}

function parseBinding(row: SqlRow): HindsightSourceObjectBinding {
  try {
    const value = HindsightSourceObjectBindingSchema.parse({ bindingId: row.binding_id, schemaVersion: row.schema_version,
      evidenceId: row.evidence_id, sourceBankId: row.source_bank_id, bankScope: JSON.parse(String(row.bank_scope_json)),
      sourceDocumentId: row.source_document_id, sourceMemoryId: row.source_memory_id,
      providerLineageId: row.provider_lineage_id, bankGeneration: row.bank_generation, bankId: row.bank_id,
      objectKind: row.object_kind, objectId: row.object_id, objectRevision: row.object_revision,
      nativePayloadHash: row.native_payload_hash, operationId: row.operation_id, requestHash: row.request_hash,
      resultHash: row.result_hash, nativeReceiptHash: row.native_receipt_hash, nativeThroughCursor: row.native_through_cursor,
      observationKind: row.observation_kind, observationId: row.observation_id, observedCursor: row.observed_cursor, confirmedAt: row.confirmed_at });
    const { bindingId, ...identity } = value;
    if (hindsightSourceBindingId(identity) !== bindingId) throw new Error();
    return value;
  } catch { throw new Error("HINDSIGHT_SOURCE_BINDING_INVALID"); }
}
