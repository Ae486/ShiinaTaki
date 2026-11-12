/**
 * INPUT: an exact primary Timeline witness and durable provider ingestion journals
 * OUTPUT: the original claimed span, preserving absence and immutable receipt baselines
 * POS: core/db — read-only Memory source lookup; never scans topic text or creates ingestion work
 */
import { TimelineEntrySchema } from "@taki/shared";
import type { IntentionSourceWitness } from "../initiative/intentions/intention-source.ts";
import { patternDigest } from "../initiative/patterns/pattern-source.ts";
import { primaryEntryDigest } from "../memory/canonical-ingestion-source.ts";
import { parseCanonicalIngestionState } from "./canonical-ingestion-repo.ts";
import { parseHindsightIngestionState } from "./hindsight-ingestion-repo.ts";
import type { Database } from "./sqlite.ts";

export function readPrimaryMemorySource(db: Database, witness: IntentionSourceWitness) {
  const row = db.prepare(`SELECT id,seq,character_id,role,content,parts,created_at FROM timeline_messages
    WHERE id=:id AND seq=:seq AND character_id=:character AND role='user'`)
    .get({ id: witness.userTimelineId, seq: witness.userTimelineSeq, character: witness.characterId });
  if (!row || patternDigest(row) !== witness.sourceDigest) return { kind: "withdrawn" } as const;
  const entry = TimelineEntrySchema.parse({ id: row.id, seq: row.seq, characterId: row.character_id,
    role: row.role, content: row.content, parts: row.parts === null ? undefined : JSON.parse(String(row.parts)), createdAt: row.created_at });
  const digest = primaryEntryDigest(entry);
  const params = { seq: witness.userTimelineSeq };
  const local = db.prepare(`SELECT * FROM canonical_memory_primary_commits
    WHERE timeline_seq=:seq`).get(params);
  const hindsight = db.prepare(`SELECT * FROM hindsight_ingestion_primary_commits
    WHERE timeline_seq=:seq`).get(params);
  if (local && hindsight) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  const commit = local ?? hindsight;
  if (!commit) return { kind: "unbound" } as const;
  if (commit.entry_id !== witness.userTimelineId || commit.character_id !== witness.characterId
    || commit.entry_digest !== digest) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  if (commit.ingestion_span_id === null) return { kind: "unbound", epochId: String(commit.authority_epoch_id) } as const;
  const table = local ? "canonical_memory_ingestion_spans" : "hindsight_ingestion_spans";
  const span = db.prepare(`SELECT * FROM ${table} WHERE authority_epoch_id=:epoch AND character_id=:character AND span_id=:span`)
    .get({ epoch: String(commit.authority_epoch_id), character: witness.characterId, span: String(commit.ingestion_span_id) });
  if (!span) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  const result = local ? { kind: "local" as const, state: parseCanonicalIngestionState(span) }
    : { kind: "hindsight" as const, state: parseHindsightIngestionState(span) };
  if (!result.state.source.proofs.some((proof) => proof.id === witness.userTimelineId
    && proof.seq === witness.userTimelineSeq && proof.digest === digest)) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  return result;
}
