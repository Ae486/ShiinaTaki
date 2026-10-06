/**
 * INPUT:  a Local member and the immutable emergency incident's original unknown ingestion span
 * OUTPUT: exact held-member proof; unknown old ingestion is never adopted as a new Local source
 * POS:    core/db — only an explicit foreign-branch publication authorizes this historical exemption
 */
import { readEmergencyIncident } from "./memory-transition-emergency-repo.ts";
import { emergencyRowHash } from "./memory-transition-row-hash.ts";
import { SanitizedCommittedSpanSchema, ingestionSourceDigest } from "../memory/canonical-ingestion-source.ts";
import { hindsightIngestionIdentity } from "../memory/hindsight/hindsight-ingestion-contract.ts";
import type { Database } from "./sqlite.ts";
import { hasEmergencyStorage } from "./memory-transition-emergency-quarantine.ts";

export function heldEmergencyPrimaryMember(db: Database, input: {
  targetEpochId: string; seq: number; entryId: string; digest: string; characterId: string;
}): boolean {
  if (!hasEmergencyStorage(db)) return false;
  const branch = db.prepare("SELECT * FROM memory_transition_foreign_branches WHERE target_epoch_id=:epoch").get({ epoch: input.targetEpochId });
  if (!branch) return false;
  const witness = db.prepare("SELECT * FROM hindsight_ingestion_primary_commits WHERE timeline_seq=:seq AND authority_epoch_id=:epoch")
    .get({ seq: input.seq, epoch: String(branch.source_epoch_id) });
  if (!witness?.ingestion_span_id) return false;
  const span = db.prepare("SELECT * FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch AND character_id=:character AND span_id=:id")
    .get({ epoch: String(branch.source_epoch_id), character: input.characterId, id: String(witness.ingestion_span_id) });
  const incident = readEmergencyIncident(db, String(branch.transition_id));
  if (!span || span.state === "complete" || witness.entry_id !== input.entryId || witness.entry_digest !== input.digest
    || witness.character_id !== input.characterId || span.provider_lineage_id !== branch.provider_lineage_id
    || !incident?.transition?.unknownEffects.some((effect) => effect.table === "hindsight_ingestion_spans"
      && effect.epochId === branch.source_epoch_id && effect.recordKey === JSON.stringify([input.characterId, span.span_id])
      && effect.rowHash === emergencyRowHash(span))) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  const source = SanitizedCommittedSpanSchema.parse(JSON.parse(String(span.source_json)));
  if (ingestionSourceDigest(source) !== span.source_hash || source.characterId !== input.characterId
    || source.fromSeq !== span.from_seq || source.throughSeq !== span.through_seq
    || hindsightIngestionIdentity({ epochId: String(branch.source_epoch_id), characterId: input.characterId, sourceHash: String(span.source_hash) }) !== span.span_id
    || !source.proofs.some((proof) => proof.seq === input.seq && proof.id === input.entryId && proof.digest === input.digest)) {
    throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  }
  return true;
}
