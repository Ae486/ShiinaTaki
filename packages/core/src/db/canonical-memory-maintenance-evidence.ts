/**
 * INPUT:  new Core-produced automatic sources and explicit canonical fact references
 * OUTPUT: versioned source evidence that preserves original provenance and unrelated JSON fields
 * POS:    core/db — inert metadata association carried by the existing logical source interchange
 */
import { HindsightCurrentCanonicalSourceSchema, type CanonicalMemorySource } from "@taki/shared";
import { z } from "zod";
import type { CanonicalMaintenanceTarget } from "./canonical-memory-maintenance-contract.ts";
import { readCanonicalSource } from "./canonical-memory-maintenance-records.ts";
import type { Database } from "./sqlite.ts";

export const CANONICAL_LOCAL_EVIDENCE_KEY = "taki:local-evidence:v1";
const Id = z.string().min(1).max(256);
const Reference = z.strictObject({ epochId: Id, bankId: Id, memoryId: Id });
const Evidence = z.strictObject({ version: z.literal(1), targets: z.array(Reference).max(256) });
export type CanonicalEvidenceReference = z.infer<typeof Reference>;

export function annotateCanonicalIngestionSource(source: CanonicalMemorySource, targets: CanonicalEvidenceReference[]): CanonicalMemorySource {
  if (targets.length === 0) return source;
  if (source.provenance.origin !== "auto-gate" || Object.hasOwn(source.metadata, CANONICAL_LOCAL_EVIDENCE_KEY)) {
    throw new Error("MEMORY_INVALID_REQUEST: source evidence namespace conflict");
  }
  if (targets.some((target) => target.epochId !== source.authorityEpochId || target.bankId !== source.bankId)) {
    throw new Error("MEMORY_AUTHORITY_MISMATCH");
  }
  const evidence = Evidence.parse({ version: 1, targets });
  return HindsightCurrentCanonicalSourceSchema.parse({ ...source,
    metadata: { ...source.metadata, [CANONICAL_LOCAL_EVIDENCE_KEY]: evidence } });
}

export function canonicalEvidenceTargets(source: CanonicalMemorySource): CanonicalEvidenceReference[] {
  // Imported unknown metadata remains opaque. Only this version's bounded data shape is interpreted,
  // and its strings are never evaluated as instructions or treated as authorization.
  if (source.provenance.origin !== "auto-gate") return [];
  const parsed = Evidence.safeParse(source.metadata[CANONICAL_LOCAL_EVIDENCE_KEY]);
  return parsed.success ? parsed.data.targets : [];
}

export function readCanonicalEvidenceSources(db: Database, target: CanonicalMaintenanceTarget): CanonicalMemorySource[] {
  const rows = db.prepare(`SELECT document_id FROM canonical_memory_sources
    WHERE authority_epoch_id=:epoch AND bank_id=:bank
      AND json_type(metadata_json, '$."taki:local-evidence:v1"')='object' ORDER BY document_id`)
    .all({ epoch: target.epochId, bank: target.bankId });
  return rows.flatMap((row) => {
    const source = readCanonicalSource(db, { epochId: target.epochId, bankId: target.bankId,
      documentId: String(row.document_id) });
    if (!source) throw new Error("MEMORY_INTEGRITY_ERROR: evidence source missing");
    return canonicalEvidenceTargets(source).some((ref) => ref.epochId === target.epochId
      && ref.bankId === target.bankId && ref.memoryId === target.memoryId) ? [source] : [];
  });
}

export function remapCanonicalSourceEvidence(source: CanonicalMemorySource, input: {
  sourceBankId: string; destinationBankId: string; memories: ReadonlyMap<string, string>;
}): CanonicalMemorySource {
  const targets = canonicalEvidenceTargets(source);
  if (targets.length === 0) return source;
  const mapped = targets.map((target) => {
    const memoryId = target.epochId === source.authorityEpochId && target.bankId === input.sourceBankId
      ? input.memories.get(target.memoryId) : undefined;
    return memoryId ? { ...target, bankId: input.destinationBankId, memoryId } : target;
  });
  return HindsightCurrentCanonicalSourceSchema.parse({ ...source,
    metadata: { ...source.metadata, [CANONICAL_LOCAL_EVIDENCE_KEY]: { version: 1, targets: mapped } } });
}
