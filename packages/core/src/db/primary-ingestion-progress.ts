/**
 * INPUT: exact provider witnesses, completed span state and the Character eligibility baseline
 * OUTPUT: bounded conversation groups and the first unresolved continuous-coverage boundary
 * POS: core/db — shared Local/Hindsight progress queries; never manufactures source proof
 */
import type { ProvenPrimaryEntry, IngestionCoverageGap } from "../memory/canonical-ingestion-source.ts";
import type { Database } from "./sqlite.ts";

/** Batch adjacent known messages, but never join across a user occurrence absent from this batch. */
export function firstPrimaryIngestionGroup(db: Database, entries: ProvenPrimaryEntry[]): ProvenPrimaryEntry[] {
  const first = entries[0]; const last = entries.at(-1);
  if (!first || !last) return entries;
  const gap = db.prepare(`SELECT MIN(seq) AS seq FROM timeline_messages WHERE character_id=:character
    AND role='user' AND seq>:after AND seq<:through
    AND seq NOT IN (SELECT value FROM json_each(:selected))`)
    .get({ character: first.entry.characterId, after: first.entry.seq, through: last.entry.seq,
      selected: JSON.stringify(entries.map((proof) => proof.entry.seq)) });
  return gap?.seq == null ? entries : entries.filter((proof) => proof.entry.seq < Number(gap.seq));
}

export function primaryIngestionCoverageGap(db: Database, input: {
  provider: "local" | "hindsight"; epochId: string; characterId: string; throughSeq: number; eligibilityStartSeq: number;
}): IngestionCoverageGap | undefined {
  const commits = input.provider === "local" ? "canonical_memory_primary_commits" : "hindsight_ingestion_primary_commits";
  const spans = input.provider === "local" ? "canonical_memory_ingestion_spans" : "hindsight_ingestion_spans";
  const row = db.prepare(`SELECT seq,code FROM (
    SELECT t.seq AS seq,'MEMORY_INGESTION_SOURCE_UNPROVEN' AS code FROM timeline_messages t
    LEFT JOIN ${commits} p ON p.timeline_seq=t.seq AND p.authority_epoch_id=:epoch
    WHERE t.character_id=:character AND t.seq>=:start AND t.seq<=:through AND t.role='user' AND p.timeline_seq IS NULL
    UNION ALL
    SELECT p.timeline_seq AS seq,'MEMORY_INGESTION_INCOMPLETE' AS code FROM ${commits} p
    LEFT JOIN ${spans} s ON s.authority_epoch_id=p.authority_epoch_id AND s.character_id=p.character_id AND s.span_id=p.ingestion_span_id
    WHERE p.authority_epoch_id=:epoch AND p.character_id=:character AND p.timeline_seq<=:through
    AND (p.ingestion_span_id IS NULL OR s.state IS NULL OR s.state<>'complete')
  ) ORDER BY seq LIMIT 1`).get({ epoch: input.epochId, character: input.characterId,
    start: input.eligibilityStartSeq, through: input.throughSeq });
  if (!row) return undefined;
  return { seq: Number(row.seq), code: row.code === "MEMORY_INGESTION_INCOMPLETE"
    ? "MEMORY_INGESTION_INCOMPLETE" : "MEMORY_INGESTION_SOURCE_UNPROVEN" };
}
