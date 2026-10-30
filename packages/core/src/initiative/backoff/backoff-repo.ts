/**
 * INPUT: persisted C2 dispositions and actual same-Character user Timeline rows
 * OUTPUT: monotonic full-reset fences and an exact rolling qualified-feedback count
 * POS: core/initiative/backoff — reads producer truth; never writes feedback or hard budgets
 */
import { z } from "zod";
import type { Database } from "../../db/sqlite.ts";

export const BACKOFF_WINDOW_MS = 7 * 86_400_000;
const ResetSchema = z.strictObject({
  timelineSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  resetAt: z.string().datetime(), reason: z.enum(["user-engagement", "operator"]),
});
export type BackoffReset = z.infer<typeof ResetSchema>;
export interface BackoffEvidence {
  qualifiedWeakCount: number; windowSince: string; reset?: BackoffReset;
}

export function readBackoffEvidence(db: Database, input: { characterId: string; now: number }): BackoffEvidence {
  const reset = readReset(db, input.characterId);
  const windowSince = new Date(input.now - BACKOFF_WINDOW_MS).toISOString();
  // A full reset retires every earlier invitation, including pending feedback that settles later.
  // C2 is the evidence authority: no timeout, delivery receipt or opportunity estimate is reclassified here.
  const count = db.prepare(`SELECT count(*) AS n FROM initiative_feedback
    WHERE character_id=:characterId AND disposition='weak_non_engagement'
      AND timeline_seq>:resetSeq AND settled_at>=:since AND settled_at<=:at`)
    .get({ characterId: input.characterId, resetSeq: reset?.timelineSeq ?? 0,
      since: windowSince, at: new Date(input.now).toISOString() });
  return { qualifiedWeakCount: Number(count?.n ?? 0), windowSince, ...(reset ? { reset } : {}) };
}

export function recoverBackoffEngagement(db: Database, input: { characterId: string; now: number }): boolean {
  let changed = false;
  db.transaction(() => {
    const reset = readReset(db, input.characterId);
    // Primary user input is the only production writer of ordinary role=user rows. C2 uses
    // this same persisted evidence; a callback without a row cannot reset policy.
    const row = db.prepare(`SELECT seq,created_at FROM timeline_messages
      WHERE character_id=:characterId AND role='user' AND seq>:seq AND created_at<=:at
      ORDER BY seq DESC LIMIT 1`).get({ characterId: input.characterId, seq: reset?.timelineSeq ?? 0,
      at: new Date(input.now).toISOString() });
    if (!row) return;
    writeReset(db, { characterId: input.characterId, timelineSeq: Number(row.seq),
      resetAt: String(row.created_at), reason: "user-engagement" });
    changed = true;
  });
  return changed;
}

export function resetBackoffByOperator(db: Database, input: { characterId: string; now: number }): void {
  db.transaction(() => {
    const seq = db.prepare("SELECT max(seq) AS seq FROM timeline_messages WHERE character_id=:characterId")
      .get({ characterId: input.characterId })?.seq;
    writeReset(db, { characterId: input.characterId, timelineSeq: Number(seq ?? 0),
      resetAt: new Date(input.now).toISOString(), reason: "operator" });
  });
}

function readReset(db: Database, characterId: string): BackoffReset | undefined {
  const row = db.prepare("SELECT * FROM initiative_backoff_resets WHERE character_id=:characterId").get({ characterId });
  return row ? ResetSchema.parse({ timelineSeq: row.timeline_seq, resetAt: row.reset_at, reason: row.reason }) : undefined;
}

function writeReset(db: Database, input: BackoffReset & { characterId: string }): void {
  db.prepare(`INSERT INTO initiative_backoff_resets(character_id,timeline_seq,reset_at,reason)
    VALUES(:characterId,:timelineSeq,:resetAt,:reason) ON CONFLICT(character_id) DO UPDATE
    SET timeline_seq=max(timeline_seq,:timelineSeq),reset_at=max(reset_at,:resetAt),reason=:reason`)
    .run({ ...input });
}
