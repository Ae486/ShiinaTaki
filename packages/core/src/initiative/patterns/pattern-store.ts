/**
 * INPUT: Core SQLite and validated Character-scoped Pattern values
 * OUTPUT: bounded current/history reads and transaction-local identity/revision writes
 * POS: core/initiative/patterns — SQL aggregate persistence; service owns authorization and post-commit events
 */
import {
  InteractionPatternRevisionSchema, InteractionPatternViewSchema,
  type InteractionPatternDefinition, type InteractionPatternOrigin, type InteractionPatternRevision,
  type InteractionPatternView, type InteractionPatternListParams, type InteractionPatternListResult,
  type InteractionPatternHistoryParams, type InteractionPatternHistoryResult,
} from "@taki/shared";
import type { Database, SqlRow } from "../../db/sqlite.ts";

export function readPatternRevision(db: Database, revisionId: string): InteractionPatternRevision | null {
  const row = db.prepare(`SELECT r.*,a.accepted_at FROM interaction_pattern_revisions r
    LEFT JOIN interaction_pattern_reviews a ON a.revision_id=r.revision_id WHERE r.revision_id=:revisionId`).get({ revisionId });
  return row ? projectRevision(row) : null;
}

function projectRevision(row: SqlRow): InteractionPatternRevision {
  return InteractionPatternRevisionSchema.parse({
    revisionId: row.revision_id, baseVersion: row.base_version,
    definition: JSON.parse(String(row.definition_json)), origin: JSON.parse(String(row.origin_json)),
    changes: JSON.parse(String(row.changes_json)), createdAt: row.created_at, acceptedAt: row.accepted_at,
  });
}

export function readPattern(db: Database, scope: { characterId: string; patternId: string }): InteractionPatternView | null {
  const row = db.prepare("SELECT * FROM interaction_patterns WHERE pattern_id=:patternId AND character_id=:characterId")
    .get({ patternId: scope.patternId, characterId: scope.characterId });
  if (!row) return null;
  const effective = row.effective_revision_id === null ? null : readPatternRevision(db, String(row.effective_revision_id));
  const candidate = row.candidate_revision_id === null ? null : readPatternRevision(db, String(row.candidate_revision_id));
  return InteractionPatternViewSchema.parse({ patternId: row.pattern_id, characterId: row.character_id,
    state: row.state, version: row.version, effectiveRevision: effective, candidateRevision: candidate,
    createdAt: row.created_at, updatedAt: row.updated_at });
}

export function listPatterns(db: Database, query: InteractionPatternListParams): InteractionPatternListResult {
  const rows = db.prepare(`SELECT pattern_id FROM interaction_patterns WHERE character_id=:characterId
    AND (:after IS NULL OR pattern_id>:after) ORDER BY pattern_id LIMIT :limit`)
    .all({ characterId: query.characterId, after: query.after, limit: query.limit + 1 });
  const patterns = rows.slice(0, query.limit).map((row) => requirePattern(db, { characterId: query.characterId, patternId: String(row.pattern_id) }));
  return { patterns, nextAfter: rows.length > query.limit ? (patterns.at(-1)?.patternId ?? null) : null };
}

export function patternHistory(db: Database, query: InteractionPatternHistoryParams): InteractionPatternHistoryResult {
  const rows = db.prepare(`SELECT r.*,a.accepted_at FROM interaction_pattern_revisions r
    JOIN interaction_patterns p ON p.pattern_id=r.pattern_id
    LEFT JOIN interaction_pattern_reviews a ON a.revision_id=r.revision_id
    WHERE p.character_id=:characterId AND r.pattern_id=:patternId AND (:before IS NULL OR r.base_version<:before)
    ORDER BY r.base_version DESC LIMIT :limit`).all({ ...query, limit: query.limit + 1 });
  const revisions = rows.slice(0, query.limit).map(projectRevision);
  return { revisions, nextBefore: rows.length > query.limit ? (revisions.at(-1)?.baseVersion ?? null) : null };
}

export function requirePattern(db: Database, scope: { characterId: string; patternId: string }): InteractionPatternView {
  const result = readPattern(db, scope);
  if (!result) throw new Error("Pattern write did not produce its scoped read model");
  return result;
}

export interface PatternRevisionWrite {
  pattern: InteractionPatternView;
  revisionId: string;
  definition: InteractionPatternDefinition;
  origin: InteractionPatternOrigin;
  sourceKey: string;
  authorKey: string;
  sourceRunId: string | null;
  at: string;
  newPattern: boolean;
}

export function insertPatternRevision(db: Database, input: PatternRevisionWrite): void {
  const before = input.pattern.effectiveRevision?.definition;
  const changes = (Object.keys(input.definition) as (keyof InteractionPatternDefinition)[])
    .filter((field) => !before || JSON.stringify(before[field]) !== JSON.stringify(input.definition[field]));
  db.prepare(`INSERT INTO interaction_pattern_revisions(revision_id,pattern_id,base_version,definition_json,origin_json,changes_json,author_key,source_run_id,source_key,created_at)
    VALUES(:revisionId,:patternId,:baseVersion,:definition,:origin,:changes,:authorKey,:sourceRunId,:sourceKey,:at)`)
    .run({ revisionId: input.revisionId, patternId: input.pattern.patternId,
      baseVersion: input.newPattern ? 0 : input.pattern.version, definition: JSON.stringify(input.definition),
      origin: JSON.stringify(input.origin), changes: JSON.stringify(changes), authorKey: input.authorKey,
      sourceRunId: input.sourceRunId, sourceKey: input.sourceKey, at: input.at });
  updatePattern(db, { pattern: input.pattern, at: input.at, candidateRevisionId: input.revisionId,
    effectiveRevisionId: input.pattern.effectiveRevision?.revisionId ?? null, state: input.pattern.state,
    increment: !input.newPattern });
}

export function updatePattern(db: Database, input: {
  pattern: InteractionPatternView; at: string; candidateRevisionId: string | null;
  effectiveRevisionId: string | null; state: InteractionPatternView["state"]; increment: boolean;
}): void {
  const result = db.prepare(`UPDATE interaction_patterns SET state=:state,version=version+:increment,
    candidate_revision_id=:candidate,effective_revision_id=:effective,updated_at=:at
    WHERE pattern_id=:patternId AND character_id=:characterId AND version=:version`)
    .run({ state: input.state, increment: input.increment ? 1 : 0, candidate: input.candidateRevisionId,
      effective: input.effectiveRevisionId, at: input.at, patternId: input.pattern.patternId,
      characterId: input.pattern.characterId, version: input.pattern.version });
  if (result.changes !== 1) throw new Error("Pattern CAS failed within its writer transaction");
}

export function patternCount(db: Database, characterId: string): number {
  return Number(db.prepare("SELECT count(*) AS count FROM interaction_patterns WHERE character_id=:characterId").get({ characterId })?.count ?? 0);
}

export function patternRevisionCount(db: Database, patternId: string): number {
  return Number(db.prepare("SELECT count(*) AS count FROM interaction_pattern_revisions WHERE pattern_id=:patternId").get({ patternId })?.count ?? 0);
}
