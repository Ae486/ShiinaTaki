/**
 * INPUT: proven Source aliases, ordered exact artifact references and actual Local Source edits
 * OUTPUT: live evidence reads and durable association intent without rewriting opaque Source metadata
 * POS: core/db — Source reference snapshots preserve order/multiplicity; callers own canonical writer transactions
 */
import { MemoryTransitionSourceAliasSchema, MemoryTransitionSourceReferenceSchema,
  type MemoryTransitionSourceAlias, type MemoryTransitionSourceReference, type MemoryTransitionSourceSet,
  type CanonicalMemorySource } from "@taki/shared";
import type { Database } from "./sqlite.ts";

type Identity = { epochId: string; bankId: string; memoryId: string };
export function hasCanonicalSourceReferences(db: Database): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='canonical_memory_source_references' AND type='table'").get());
}
export function readCanonicalSourceAliases(db: Database, epochId: string): MemoryTransitionSourceAlias[] {
  return db.prepare("SELECT * FROM canonical_memory_source_aliases WHERE authority_epoch_id=:epoch ORDER BY bank_id,artifact_key").all({ epoch: epochId }).map((row) => {
    const alias = MemoryTransitionSourceAliasSchema.parse(JSON.parse(String(row.evidence_json)));
    if (alias.bankId !== row.bank_id || alias.documentId !== row.document_id || JSON.stringify(alias.artifact.key) !== row.artifact_key) invalid();
    return alias;
  });
}
export function readCanonicalSourceSet(db: Database, input: Identity): MemoryTransitionSourceSet | undefined {
  if (!hasCanonicalSourceReferences(db)) return undefined;
  const params = { epoch: input.epochId, bank: input.bankId, memory: input.memoryId };
  if (!db.prepare("SELECT 1 FROM canonical_memory_source_sets WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory").get(params)) return undefined;
  const references = db.prepare("SELECT * FROM canonical_memory_source_references WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory ORDER BY ordinal")
    .all(params).map((row, ordinal) => {
      const reference = MemoryTransitionSourceReferenceSchema.parse(JSON.parse(String(row.evidence_json)));
      if (row.ordinal !== ordinal || reference.documentId !== row.document_id || reference.source.authorityEpochId !== input.epochId
        || reference.source.bankId !== input.bankId) invalid();
      return reference;
    });
  return { bankId: input.bankId, memoryId: input.memoryId, references };
}
export function insertCanonicalSourceAlias(db: Database, epochId: string, alias: MemoryTransitionSourceAlias): void {
  db.prepare("INSERT INTO canonical_memory_source_aliases VALUES(:epoch,:bank,:document,:key,:body)")
    .run({ epoch: epochId, bank: alias.bankId, document: alias.documentId, key: JSON.stringify(alias.artifact.key), body: JSON.stringify(alias) });
}
export function replaceCanonicalSourceSet(db: Database, input: Identity & { references: MemoryTransitionSourceReference[] }): void {
  const params = { epoch: input.epochId, bank: input.bankId, memory: input.memoryId };
  db.prepare("INSERT OR IGNORE INTO canonical_memory_source_sets VALUES(:epoch,:bank,:memory)").run(params);
  db.prepare("DELETE FROM canonical_memory_source_references WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory").run(params);
  for (const [ordinal, raw] of input.references.entries()) {
    const reference = MemoryTransitionSourceReferenceSchema.parse(raw);
    if (reference.source.authorityEpochId !== input.epochId || reference.source.bankId !== input.bankId) invalid();
    db.prepare("INSERT INTO canonical_memory_source_references VALUES(:epoch,:bank,:memory,:ordinal,:document,:body)")
      .run({ ...params, ordinal, document: reference.documentId, body: JSON.stringify(reference) });
  }
}
export function markCanonicalSourceReferencesChanged(db: Database, source: CanonicalMemorySource): void {
  if (!hasCanonicalSourceReferences(db)) return;
  const params = { epoch: source.authorityEpochId, bank: source.bankId, document: source.documentId };
  for (const row of db.prepare("SELECT * FROM canonical_memory_source_references WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:document").all(params)) {
    const old = MemoryTransitionSourceReferenceSchema.parse(JSON.parse(String(row.evidence_json)));
    const reference: MemoryTransitionSourceReference = { ...old, source, intent: "local" };
    db.prepare("UPDATE canonical_memory_source_references SET evidence_json=:body WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory AND ordinal=:ordinal")
      .run({ epoch: source.authorityEpochId, bank: source.bankId, memory: row.memory_id ?? null, ordinal: row.ordinal ?? null, body: JSON.stringify(reference) });
  }
}
export function canonicalSourceReferenced(db: Database, input: { epochId: string; bankId: string; documentId: string }): boolean {
  return hasCanonicalSourceReferences(db) && Boolean(db.prepare("SELECT 1 FROM canonical_memory_source_references WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:document LIMIT 1")
    .get({ epoch: input.epochId, bank: input.bankId, document: input.documentId }));
}
function invalid(): never { throw new Error("MEMORY_INTEGRITY_ERROR: Source reference evidence mismatch"); }
