/**
 * INPUT:  the predecessor Local epoch, the freshly inserted Hindsight epoch and the promotion clock, inside promoteHindsightAuthority
 * OUTPUT: carryHindsightActivationCustody() — refuses incomplete Local spans, copies unconsumed Local witnesses into the Hindsight
 *         witness table, seeds per-Character Hindsight cursors and reassigns open/finalized custody groups; reports the counts
 * POS:    core/db — PR03 Local -> Hindsight custody carry; SQL only, same transaction as the authority switch, no model or network
 */
import type { Database } from "./sqlite.ts";

export interface HindsightCustodyCarryInput { predecessorEpochId: string; hindsightEpochId: string; now: string }
export interface HindsightCustodyCarryResult { carriedWitnessCount: number; cursorCount: number; reassignedGroupCount: number }

export function carryHindsightActivationCustody(db: Database, input: HindsightCustodyCarryInput): HindsightCustodyCarryResult {
  const previous = input.predecessorEpochId; const epoch = input.hindsightEpochId;
  const active = db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state WHERE singleton=1").get();
  if (active?.active_epoch_id !== epoch) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const pending = db.prepare("SELECT 1 AS pending FROM canonical_memory_ingestion_spans WHERE authority_epoch_id=:previous AND state<>'complete' LIMIT 1")
    .get({ previous });
  if (pending) throw new Error("MEMORY_INGESTION_INCOMPLETE");
  // Carried rows sit below the new baseline on purpose: Hindsight ingestion consumes them as late sources while every
  // commit after COMMIT falls at or above eligibility_start_seq and is witnessed only in the Hindsight table.
  const carried = db.prepare(`INSERT INTO hindsight_ingestion_primary_commits
    (timeline_seq,authority_epoch_id,character_id,entry_id,entry_digest,committed_through_seq,ingestion_span_id,run_id,committed_at)
    SELECT timeline_seq,:epoch,character_id,entry_id,entry_digest,committed_through_seq,NULL,run_id,committed_at
    FROM canonical_memory_primary_commits WHERE authority_epoch_id=:previous AND ingestion_span_id IS NULL ORDER BY timeline_seq`).run({ epoch, previous });
  const cursors = db.prepare(`INSERT INTO hindsight_ingestion_cursors (authority_epoch_id,character_id,through_seq,eligibility_start_seq,updated_at)
    SELECT :epoch,c.character_id,0,COALESCE((SELECT MAX(t.seq) FROM timeline_messages t WHERE t.character_id=c.character_id),0)+1,:now
    FROM (SELECT character_id FROM canonical_memory_ingestion_cursors WHERE authority_epoch_id=:previous
      UNION SELECT character_id FROM canonical_memory_primary_commits WHERE authority_epoch_id=:previous AND ingestion_span_id IS NULL
      UNION SELECT character_id FROM primary_memory_groups WHERE assigned_epoch_id=:previous AND state IN ('open','finalized')) c`)
    .run({ epoch, previous, now: input.now });
  const groups = db.prepare("UPDATE primary_memory_groups SET assigned_epoch_id=:epoch WHERE assigned_epoch_id=:previous AND state IN ('open','finalized')")
    .run({ epoch, previous });
  return { carriedWitnessCount: carried.changes, cursorCount: cursors.changes, reassignedGroupCount: groups.changes };
}
