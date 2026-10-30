/**
 * INPUT: validated finite Intention aggregates and exact existing Run keys
 * OUTPUT: bounded SQL reads and transaction-local domain state changes
 * POS: core/initiative/intentions — subordinate persistence; callers own transactions and publication
 */
import { InitiativeIntentionSchema, type InitiativeIntention, type InitiativeIntentionDisposition } from "@taki/shared";
import type { Database, SqlRow } from "../../db/sqlite.ts";

export interface IntentionScope { characterId: string; intentionId: string }
export interface IntentionClaim extends IntentionScope { canonicalRunKey: string }

export function readIntention(db: Database, scope: IntentionScope): InitiativeIntention | null {
  const row = db.prepare("SELECT * FROM initiative_intentions WHERE intention_id=:intentionId AND character_id=:characterId")
    .get({ intentionId: scope.intentionId, characterId: scope.characterId });
  return row ? project(row) : null;
}

export function readSourceIntention(db: Database, sourceKey: string): InitiativeIntention | null {
  const row = db.prepare("SELECT * FROM initiative_intentions WHERE source_key=:sourceKey").get({ sourceKey });
  return row ? project(row) : null;
}

export function readOpenIntentions(db: Database, input: { characterId?: string; after?: string; limit?: number }): InitiativeIntention[] {
  return db.prepare(`SELECT * FROM initiative_intentions WHERE state<>'terminal'
    AND (:characterId IS NULL OR character_id=:characterId) AND intention_id>:after ORDER BY intention_id LIMIT :limit`)
    .all({ characterId: input.characterId ?? null, after: input.after ?? "", limit: input.limit ?? 1000 }).map(project);
}

export function insertIntention(db: Database, value: InitiativeIntention): void {
  db.prepare(`INSERT INTO initiative_intentions(intention_id,character_id,source_key,source_json,source_run_id,purpose,
    reported_event_time,not_before,expires_at,state,created_at) VALUES(:id,:characterId,:sourceKey,:source,:sourceRunId,
    :purpose,:reportedEventTime,:notBefore,:expiresAt,'active',:at)`)
    .run({ id: value.intentionId, characterId: value.characterId, sourceKey: value.sourceKey, source: JSON.stringify(value.source),
      sourceRunId: value.source.runId, purpose: value.purpose, reportedEventTime: value.reportedEventTime,
      notBefore: value.notBefore, expiresAt: value.expiresAt, at: value.createdAt });
}

export function closeIntention(db: Database, input: { scope: IntentionScope; disposition: InitiativeIntentionDisposition; at: string }): boolean {
  return db.prepare(`UPDATE initiative_intentions SET state='terminal',disposition=:disposition,terminal_at=:at,
    purpose=NULL,reported_event_time=NULL WHERE intention_id=:intentionId AND character_id=:characterId AND state<>'terminal'`)
    .run({ intentionId: input.scope.intentionId, characterId: input.scope.characterId,
      disposition: input.disposition, at: input.at }).changes === 1;
}

export function claimIntention(db: Database, input: IntentionClaim): boolean {
  return db.prepare(`UPDATE initiative_intentions SET state='claimed',canonical_run_key=:canonicalRunKey
    WHERE intention_id=:intentionId AND character_id=:characterId AND state='active'`)
    .run({ intentionId: input.intentionId, characterId: input.characterId, canonicalRunKey: input.canonicalRunKey }).changes === 1;
}

export function linkedRun(db: Database, claim: IntentionClaim) {
  return db.prepare(`SELECT run_id,state FROM runs WHERE idempotency_key=:key AND character_id=:characterId
    AND initiator='heartbeat'`).get({ key: claim.canonicalRunKey, characterId: claim.characterId });
}

export function attachIntentionRun(db: Database, input: IntentionClaim & { runId: string }): boolean {
  return db.prepare(`UPDATE initiative_intentions SET run_id=:runId WHERE intention_id=:intentionId AND character_id=:characterId
    AND state='claimed' AND canonical_run_key=:canonicalRunKey AND (run_id IS NULL OR run_id=:runId)`)
    .run({ intentionId: input.intentionId, characterId: input.characterId, canonicalRunKey: input.canonicalRunKey, runId: input.runId }).changes === 1;
}

export function releaseIntentionClaim(db: Database, input: IntentionClaim): boolean {
  return db.prepare(`UPDATE initiative_intentions SET state='active',canonical_run_key=NULL
    WHERE intention_id=:intentionId AND character_id=:characterId AND canonical_run_key=:canonicalRunKey
    AND state='claimed' AND run_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM runs WHERE idempotency_key=:canonicalRunKey)`)
    .run({ intentionId: input.intentionId, characterId: input.characterId, canonicalRunKey: input.canonicalRunKey }).changes === 1;
}

function project(row: SqlRow): InitiativeIntention {
  return InitiativeIntentionSchema.parse({ intentionId: row.intention_id, characterId: row.character_id,
    sourceKey: row.source_key, source: JSON.parse(String(row.source_json)), purpose: row.purpose,
    reportedEventTime: row.reported_event_time, notBefore: row.not_before, expiresAt: row.expires_at, state: row.state,
    canonicalRunKey: row.canonical_run_key, runId: row.run_id, disposition: row.disposition, createdAt: row.created_at,
    terminalAt: row.terminal_at });
}
