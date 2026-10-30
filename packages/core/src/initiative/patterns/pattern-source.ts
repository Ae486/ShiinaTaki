/**
 * INPUT: trusted primary append seam and authenticated domain actors
 * OUTPUT: immutable primary Run/user-row source binding and live source validation
 * POS: core/initiative/patterns — caller context is Core-owned, never model-authored authority
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { InteractionPatternOrigin, InteractionPatternRefusalReason } from "@taki/shared";
import type { Database, SqlRow } from "../../db/sqlite.ts";
import { primarySourceRowDigest } from "../../db/primary-source-row.ts";

const Id = z.string().min(1).max(200);
const ActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("operator"), operatorId: Id }).strict(),
  z.object({ kind: z.literal("agent"), runId: Id, attemptId: Id, toolCallId: Id }).strict(),
  z.object({ kind: z.literal("seed"), seedId: Id, seedVersion: Id }).strict(),
]);
export type InteractionPatternActor = z.infer<typeof ActorSchema>;
const PrimarySourceSchema = z.object({
  characterId: Id, runId: Id, attemptId: Id,
  userTimelineSeq: z.number().int().positive(), userTimelineId: Id,
}).strict();
export type InteractionPatternPrimarySource = z.infer<typeof PrimarySourceSchema>;

export function patternDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function patternActorKey(actor: InteractionPatternActor): string {
  if (actor.kind === "operator") return `operator:${actor.operatorId}`;
  if (actor.kind === "agent") return `agent:${actor.runId}`;
  return `seed:${actor.seedId}`;
}

export function patternOrigin(actor: InteractionPatternActor): InteractionPatternOrigin {
  if (actor.kind === "operator") return { kind: "user", description: "Created through user management." };
  if (actor.kind === "agent") return { kind: "agent", description: "Proposed during the current user conversation." };
  return { kind: "seed", description: "Bundled example submitted for explicit review." };
}

function primaryRun(db: Database, input: { characterId: string; runId: string; attemptId: string }): SqlRow | undefined {
  return db.prepare(`SELECT run_id,started_at FROM runs WHERE run_id=:runId AND character_id=:characterId
    AND initiator='primary' AND state='running' AND active_attempt_id=:attemptId
    AND EXISTS(SELECT 1 FROM run_attempts WHERE attempt_id=:attemptId AND run_id=:runId AND state='effect_running')`)
    .get({ characterId: input.characterId, runId: input.runId, attemptId: input.attemptId });
}

function sourceRow(db: Database, input: { characterId: string; seq: number; id: string }): SqlRow | undefined {
  return db.prepare(`SELECT id,seq,character_id,role,content,parts,created_at,source_context_json FROM timeline_messages
    WHERE character_id=:characterId AND seq=:seq AND id=:id AND role='user'`).get(input);
}

/** Called only at the actual ChatAgent append seam. The model cannot select a source row. */
export function registerPatternPrimarySource(db: Database, raw: InteractionPatternPrimarySource): boolean {
  const parsed = PrimarySourceSchema.safeParse(raw);
  if (!parsed.success) return false;
  const input = parsed.data;
  let accepted = false;
  db.transaction(() => {
    const run = primaryRun(db, input);
    const row = sourceRow(db, { characterId: input.characterId, seq: input.userTimelineSeq, id: input.userTimelineId });
    if (!run || !row || !validSourceTime(run.started_at, row.created_at)) return;
    const existing = db.prepare("SELECT * FROM interaction_pattern_primary_sources WHERE run_id=:runId").get({ runId: input.runId });
    const digest = primarySourceRowDigest(row);
    if (existing) {
      accepted = existing.timeline_id === input.userTimelineId && existing.timeline_seq === input.userTimelineSeq && existing.source_digest === digest;
      return;
    }
    const count = db.prepare("SELECT count(*) AS count FROM interaction_pattern_primary_sources WHERE character_id=:characterId").get({ characterId: input.characterId });
    if (Number(count?.count) >= 10000) return;
    db.prepare(`INSERT INTO interaction_pattern_primary_sources(run_id,character_id,timeline_seq,timeline_id,source_digest,created_at)
      VALUES(:runId,:characterId,:seq,:id,:digest,:at)`).run({ runId: input.runId, characterId: input.characterId,
      seq: input.userTimelineSeq, id: input.userTimelineId, digest, at: String(row.created_at) });
    accepted = true;
  });
  return accepted;
}

function validSourceTime(startedAt: unknown, createdAt: unknown): boolean {
  if (typeof startedAt !== "string" || typeof createdAt !== "string") return false;
  const started = Date.parse(startedAt);
  const created = Date.parse(createdAt);
  return Number.isFinite(started) && Number.isFinite(created) && created >= started;
}

export function validatePatternActor(db: Database, characterId: string, raw: InteractionPatternActor): InteractionPatternRefusalReason | null {
  const parsed = ActorSchema.safeParse(raw);
  if (!parsed.success) return "forbidden";
  const actor = parsed.data;
  if (actor.kind !== "agent") return null;
  if (!primaryRun(db, { characterId, runId: actor.runId, attemptId: actor.attemptId })) return "source_stale";
  return validateStoredSource(db, { characterId, runId: actor.runId });
}

/** A finished authoring Run is allowed at review; removed or altered user evidence is not. */
export function validatePatternRevisionSource(db: Database, revisionId: string): InteractionPatternRefusalReason | null {
  const revision = db.prepare(`SELECT r.source_run_id,p.character_id FROM interaction_pattern_revisions r
    JOIN interaction_patterns p ON p.pattern_id=r.pattern_id WHERE r.revision_id=:revisionId`).get({ revisionId });
  if (!revision) return "source_unavailable";
  if (revision.source_run_id === null) return null;
  return validateStoredSource(db, { characterId: String(revision.character_id), runId: String(revision.source_run_id) });
}

function validateStoredSource(db: Database, input: { characterId: string; runId: string }): InteractionPatternRefusalReason | null {
  const source = db.prepare("SELECT * FROM interaction_pattern_primary_sources WHERE run_id=:runId AND character_id=:characterId")
    .get(input);
  if (!source) return "source_unavailable";
  const row = sourceRow(db, { characterId: input.characterId, seq: Number(source.timeline_seq), id: String(source.timeline_id) });
  return row && primarySourceRowDigest(row) === source.source_digest ? null : "source_stale";
}
