/**
 * INPUT: proven pre-intent retry exhaustion and explicit/fresh admission opportunities
 * OUTPUT: durable operator attention until a new safe opportunity is offered
 * POS: core/db — no consumer reclassification, batch release or replay
 */
import type { Database } from "./sqlite.ts";

export function readInboxRetryFailures(db: Database): string[] {
  return db.prepare("SELECT character_id FROM subagent_inbox_retry_failures").all().map((row) => String(row.character_id));
}

export function recordInboxRetryFailure(db: Database, characterId: string): void {
  db.prepare("INSERT OR REPLACE INTO subagent_inbox_retry_failures(character_id,failed_at) VALUES(:character,:at)")
    .run({ character: characterId, at: new Date().toISOString() });
}
export function clearInboxRetryFailure(db: Database, characterId: string): void {
  db.prepare("DELETE FROM subagent_inbox_retry_failures WHERE character_id=:character").run({ character: characterId });
}
