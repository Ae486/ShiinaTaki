/**
 * INPUT: actual copied records and their ordered Local Source evidence snapshots
 * OUTPUT: genuine new Local Source identities per distinct version and exact copied reference sets
 * POS: core/db — copy transaction helper; never invents or clones a native artifact version
 */
import { HindsightCurrentCanonicalSourceSchema, type CanonicalMemoryRecord, type CanonicalMemorySource,
  type MemoryTransitionSourceReference } from "@taki/shared";
import type { CanonicalMaintenanceCopyInput } from "./canonical-memory-maintenance-contract.ts";
import { readCanonicalEvidenceSources, remapCanonicalSourceEvidence } from "./canonical-memory-maintenance-evidence.ts";
import { hasCanonicalSourceReferences, readCanonicalSourceSet, replaceCanonicalSourceSet } from "./canonical-memory-source-references.ts";
import { readCanonicalSource, upsertCanonicalSource } from "./canonical-memory-maintenance-records.ts";
import { stableRequestHash } from "./canonical-memory-repo.ts";
import type { Database } from "./sqlite.ts";

export interface CanonicalCopySources {
  sources: Map<string, CanonicalMemorySource>; documents: Map<string, string>;
  direct: Map<string, string>; references: Map<string, { sourceKey: string }[]>;
}
export function planCanonicalCopySources(db: Database, input: CanonicalMaintenanceCopyInput, records: CanonicalMemoryRecord[]): CanonicalCopySources {
  const sources = new Map<string, CanonicalMemorySource>(); const direct = new Map<string, string>();
  const references = new Map<string, { sourceKey: string }[]>();
  const add = (source: CanonicalMemorySource) => {
    const same = [...sources].find(([, old]) => old.documentId === source.documentId && stableRequestHash(old) === stableRequestHash(source));
    if (same) return same[0];
    const key = sources.has(source.documentId) ? JSON.stringify([source.documentId, stableRequestHash(source)]) : source.documentId;
    sources.set(key, source); return key;
  };
  for (const record of records) {
    if (input.bankId !== input.destinationBankId && record.unit.documentId !== null) {
      const source = readCanonicalSource(db, { ...input, documentId: record.unit.documentId });
      if (!source) throw new Error("MEMORY_INTEGRITY_ERROR: support source missing");
      direct.set(record.unit.memoryId, add(source));
    }
    const identity = { ...input, memoryId: record.unit.memoryId };
    const stored = readCanonicalSourceSet(db, identity);
    const exact = stored?.references.map((ref) => ref.source) ?? [];
    const evidence = readCanonicalEvidenceSources(db, identity);
    references.set(record.unit.memoryId, [...exact, ...evidence.filter((source) =>
      !exact.some((old) => old.documentId === source.documentId))].map((source) => ({ sourceKey: add(source) })));
  }
  const documents = new Map([...sources.keys()].sort().map((key) => [key, `local-copy-${stableRequestHash([
    "canonical-local-copy.v1", input.epochId, input.bankId, input.destinationBankId, input.requestId, "source", key])}`]));
  return { sources, documents, direct, references };
}
export function insertCanonicalCopySources(db: Database, input: CanonicalMaintenanceCopyInput, plan: CanonicalCopySources & { memories: Map<string, string> }): void {
  for (const [key, original] of plan.sources) {
    const documentId = plan.documents.get(key); if (!documentId) invalid();
    if (readCanonicalSource(db, { ...input, bankId: input.destinationBankId, documentId })) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
    const mapped = remapCanonicalSourceEvidence(original, { sourceBankId: input.bankId, destinationBankId: input.destinationBankId, memories: plan.memories });
    const source = HindsightCurrentCanonicalSourceSchema.parse({ ...mapped, bankId: input.destinationBankId, documentId, revision: 1 });
    upsertCanonicalSource(db, source, source.revision);
  }
}
export function installCanonicalCopySourceSets(db: Database, input: CanonicalMaintenanceCopyInput, plan: CanonicalCopySources & { memories: Map<string, string> }): void {
  if (!hasCanonicalSourceReferences(db)) return;
  for (const [originalId, entries] of plan.references) {
    const memoryId = plan.memories.get(originalId); if (!memoryId) invalid();
    const references: MemoryTransitionSourceReference[] = entries.map(({ sourceKey }) => {
      const documentId = plan.documents.get(sourceKey); if (!documentId) invalid();
      const source = readCanonicalSource(db, { ...input, bankId: input.destinationBankId, documentId }); if (!source) invalid();
      return { documentId, source, artifact: null, intent: "local" };
    });
    replaceCanonicalSourceSet(db, { epochId: input.epochId, bankId: input.destinationBankId, memoryId, references });
  }
}
function invalid(): never { throw new Error("MEMORY_INTEGRITY_ERROR: incomplete copy source mapping"); }
