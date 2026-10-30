/**
 * INPUT: the existing primary append witness, active Run/Attempt and current durable Timeline row
 * OUTPUT: immutable source provenance and immediate withdrawal/edit validation
 * POS: core/initiative/intentions — reuses C3 primary authority; never queries arbitrary recent history
 */
import { z } from "zod";
import { InitiativeIntentionSourceSchema, type InitiativeIntentionSource, type InitiativeIntentionRefusal } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { patternDigest, validatePatternActor } from "../patterns/pattern-source.ts";
import { primarySourceRowDigest } from "../../db/primary-source-row.ts";

const ActorSchema = z.strictObject({ runId: z.string().min(1).max(200), attemptId: z.string().min(1).max(200),
  toolCallId: z.string().min(1).max(200) });
export type IntentionActor = z.infer<typeof ActorSchema>;
export interface IntentionSourceWitness {
  characterId: string; userTimelineId: string; userTimelineSeq: number; sourceDigest: string;
}

export function intentionSourceWitness(source: InitiativeIntentionSource): IntentionSourceWitness {
  return { characterId: source.characterId, userTimelineId: source.timelineId,
    userTimelineSeq: source.timelineSeq, sourceDigest: source.digest };
}

export function captureIntentionSource(db: Database, input: { characterId: string; actor: IntentionActor }):
  { source: InitiativeIntentionSource } | { reason: InitiativeIntentionRefusal } {
  const actor = ActorSchema.safeParse(input.actor);
  if (!actor.success) return { reason: "source_stale" };
  const refusal = validatePatternActor(db, input.characterId, { ...actor.data, kind: "agent" });
  if (refusal) return { reason: refusal === "source_unavailable" ? "source_unavailable" : "source_stale" };
  const row = db.prepare(`SELECT * FROM interaction_pattern_primary_sources WHERE run_id=:runId AND character_id=:characterId`)
    .get({ runId: actor.data.runId, characterId: input.characterId });
  if (!row) return { reason: "source_unavailable" };
  return { source: InitiativeIntentionSourceSchema.parse({ kind: "primary_timeline", characterId: input.characterId,
    timelineId: row.timeline_id, timelineSeq: row.timeline_seq, digest: row.source_digest, ...actor.data }) };
}

export function intentionSourceCurrent(db: Database, source: InitiativeIntentionSource): boolean {
  const row = sourceRow(db, source);
  return row !== undefined && primarySourceRowDigest(row) === source.digest;
}

export function reportedTimeIsQuoted(db: Database, source: InitiativeIntentionSource, quote: string | null): boolean {
  if (quote === null) return true;
  const row = sourceRow(db, source);
  if (!row) return false;
  // Use the user's visible text only. Tool/media metadata cannot establish event timing.
  if (row.parts !== null) {
    const parts = z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).safeParse(JSON.parse(String(row.parts)));
    return parts.success && parts.data.filter((part) => part.type === "text").map((part) => part.text ?? "").join("").includes(quote);
  }
  return String(row.content).includes(quote);
}

export function intentionSourceKey(source: InitiativeIntentionSource): string {
  // One automatic opportunity per actual user row. Wording, selected time, tool retry and Run Attempt never mint another.
  return patternDigest(["primary-follow-up.v1", source.characterId, source.timelineId, source.timelineSeq]);
}

function sourceRow(db: Database, source: InitiativeIntentionSource) {
  return db.prepare(`SELECT id,seq,character_id,role,content,parts,created_at,source_context_json FROM timeline_messages
    WHERE id=:id AND seq=:seq AND character_id=:characterId AND role='user'`)
    .get({ id: source.timelineId, seq: source.timelineSeq, characterId: source.characterId });
}
