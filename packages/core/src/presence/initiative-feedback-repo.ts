/**
 * INPUT: ordinary published deliveries and confirmed response-opportunity intervals
 * OUTPUT: bounded durable intervals and once-only presentation/feedback facts
 * POS: core/presence — Core single writer; required facts commit with their state
 */
import { z } from "zod";
import type { Database, SqlRow } from "../db/sqlite.ts";
import { FEEDBACK_DEADLINE_MS, FEEDBACK_OPPORTUNITY_MS, PRESENCE_MAX_INTERVALS } from "./presence-policy.ts";
import { unionIntervals, type ObservedInterval } from "./observed-intervals.ts";

const Disposition = z.enum(["engaged", "weak_non_engagement", "unknown"]);
const FeedbackRecordSchema = z.strictObject({
  deliveryId: z.string(), runId: z.string(), attemptId: z.string(), characterId: z.string(),
  timelineSeq: z.number().int().positive(), publishedAt: z.string().datetime(), deadlineAt: z.string().datetime(),
  opportunityMs: z.number().int().min(0).max(FEEDBACK_OPPORTUNITY_MS),
  intervals: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])).max(PRESENCE_MAX_INTERVALS),
  disposition: Disposition.nullable(), settledAt: z.string().datetime().nullable(),
});
export type FeedbackRecord = z.infer<typeof FeedbackRecordSchema>;
export interface FeedbackFact {
  kind: "delivery.presented" | "delivery.feedback_settled";
  deliveryId: string; runId: string; attemptId: string; characterId: string; timelineSeq: number;
  occurredAt: string; opportunityMs?: number; disposition?: z.infer<typeof Disposition>;
}
interface MessageReference { characterId: string; timelineSeq: number }
export interface InitiativeFeedbackRepo {
  syncPublished(): number;
  present(reference: MessageReference): void;
  observeInterval(input: MessageReference & { start: number; end: number }): void;
  engage(characterId: string, at?: number): void;
  settleDue(at?: number): void;
  get(reference: MessageReference): FeedbackRecord | undefined;
  list(characterId: string): FeedbackRecord[];
}
interface Dependencies {
  db: Database;
  now?: () => number;
  commitFact(fact: FeedbackFact): void;
  publishFacts?(facts: readonly FeedbackFact[]): void;
}
const READ = `SELECT f.*, d.run_id, d.attempt_id FROM initiative_feedback f
  JOIN run_deliveries d ON d.delivery_id=f.delivery_id`;

export function createInitiativeFeedbackRepo(input: Dependencies): InitiativeFeedbackRepo {
  const now = input.now ?? Date.now;
  const commit = (write: (emit: (fact: FeedbackFact) => void) => void) => {
    const facts: FeedbackFact[] = [];
    input.db.transaction(() => write((fact) => { input.commitFact(fact); facts.push(fact); }));
    try { input.publishFacts?.(facts); }
    catch { /* The durable fact is already committed; an observer cannot reverse it. */ }
  };
  const get = (reference: MessageReference) => {
    const row = input.db.prepare(`${READ} WHERE f.character_id=:characterId AND f.timeline_seq=:timelineSeq`)
      .get({ characterId: reference.characterId, timelineSeq: reference.timelineSeq });
    return row ? readRecord(row) : undefined;
  };
  const context = { db: input.db, now, commit, get };
  return {
    get,
    syncPublished: () => syncPublished(context),
    present: (reference) => present(context, reference),
    observeInterval: (interval) => observeInterval(context, interval),
    engage: (characterId, at = now()) => settleRecords(context, { characterId, at }),
    settleDue: (at = now()) => settleRecords(context, { at }),
    list: (characterId) => input.db.prepare(`${READ} WHERE f.character_id=:characterId
      ORDER BY f.published_at DESC LIMIT 100`).all({ characterId }).map(readRecord),
  };
}
interface WriteContext {
  db: Database;
  now(): number;
  commit(write: (emit: (fact: FeedbackFact) => void) => void): void;
  get(reference: MessageReference): FeedbackRecord | undefined;
}

function syncPublished(context: WriteContext): number {
  // The delivery budget index bounds the qualifying class; the anti-join preserves restart/idempotency.
  const rows = context.db.prepare(`SELECT delivery_id,timeline_seq,character_id,charged_at FROM run_deliveries d
    WHERE delivery_class='class_b' AND charged_at IS NOT NULL AND timeline_seq IS NOT NULL
      AND json_extract(decision_json,'$.outcome')='speak'
      AND json_extract(decision_json,'$.responseExpectation')='invitation'
      AND NOT EXISTS (SELECT 1 FROM initiative_feedback f WHERE f.delivery_id=d.delivery_id)
    ORDER BY charged_at LIMIT 100`).all();
  context.commit(() => {
    for (const row of rows) {
      const publishedAt = String(row.charged_at);
      context.db.prepare(`INSERT INTO initiative_feedback
        (delivery_id,timeline_seq,character_id,published_at,deadline_at) VALUES(:id,:seq,:character,:published,:deadline)`)
        .run({ id: String(row.delivery_id), seq: Number(row.timeline_seq), character: String(row.character_id), published: publishedAt,
          deadline: new Date(Date.parse(publishedAt) + FEEDBACK_DEADLINE_MS).toISOString() });
    }
  });
  return rows.length;
}

function present(context: WriteContext, reference: MessageReference): void {
  context.commit((emit) => {
    const row = context.db.prepare(`SELECT d.delivery_id,d.run_id,d.attempt_id FROM run_deliveries d
      WHERE d.character_id=:characterId AND d.timeline_seq=:timelineSeq AND d.charged_at IS NOT NULL`)
      .get({ characterId: reference.characterId, timelineSeq: reference.timelineSeq });
    if (!row) return;
    const occurredAt = new Date(context.now()).toISOString();
    const write = context.db.prepare(`INSERT OR IGNORE INTO delivery_presentations(delivery_id,presented_at)
      VALUES(:id,:at)`).run({ id: String(row.delivery_id), at: occurredAt });
    if (!write.changes) return;
    const feedback = context.get(reference);
    emit({ kind: "delivery.presented", characterId: reference.characterId, timelineSeq: reference.timelineSeq, deliveryId: String(row.delivery_id),
      runId: String(row.run_id), attemptId: String(row.attempt_id), occurredAt,
      ...(feedback === undefined ? {} : { opportunityMs: feedback.opportunityMs }) });
  });
}

function observeInterval(context: WriteContext, candidate: MessageReference & { start: number; end: number }): void {
  if (!Number.isSafeInteger(candidate.start) || !Number.isSafeInteger(candidate.end) || candidate.end > context.now()) return;
  context.commit(() => {
    const record = context.get(candidate);
    if (!record || record.disposition || record.opportunityMs >= FEEDBACK_OPPORTUNITY_MS) return;
    const interval: ObservedInterval = [Math.max(candidate.start, Date.parse(record.publishedAt)),
      Math.min(candidate.end, Date.parse(record.deadlineAt))];
    // At the deadline, only already observed intervals can influence the once-only settlement.
    if (interval[1] <= interval[0] || context.now() >= Date.parse(record.deadlineAt)) return;
    const intervals = unionIntervals([...record.intervals, interval]);
    if (intervals.length > PRESENCE_MAX_INTERVALS) return;
    const opportunityMs = Math.min(FEEDBACK_OPPORTUNITY_MS, intervals.reduce((sum, [start, end]) => sum + end - start, 0));
    context.db.prepare(`UPDATE initiative_feedback SET intervals_json=:intervals,opportunity_ms=:opportunity
      WHERE delivery_id=:id AND disposition IS NULL`).run({ id: record.deliveryId, intervals: JSON.stringify(intervals), opportunity: opportunityMs });
  });
}

function settleRecords(context: WriteContext, input: { characterId?: string; at: number }): void {
  const at = Math.min(input.at, context.now());
  if (!Number.isSafeInteger(at) || at < 0) return;
  context.commit((emit) => {
    const rows = context.db.prepare(`${READ} WHERE f.disposition IS NULL
      AND (:character IS NULL OR f.character_id=:character)
      AND (:character IS NOT NULL OR f.deadline_at<=:at OR EXISTS
        (SELECT 1 FROM timeline_messages t WHERE t.character_id=f.character_id AND t.role='user'
          AND t.seq>f.timeline_seq AND t.created_at>=f.published_at AND t.created_at<f.deadline_at AND t.created_at<=:at))
      ORDER BY f.deadline_at LIMIT 100`)
      .all({ character: input.characterId ?? null, at: new Date(at).toISOString() });
    for (const row of rows) settleOne(context, { record: readRecord(row), at }, emit);
  });
}

function settleOne(context: WriteContext, input: { record: FeedbackRecord; at: number }, emit: (fact: FeedbackFact) => void): void {
  const { record, at } = input;
  if (at < Date.parse(record.publishedAt)) return;
  const beforeDeadline = at < Date.parse(record.deadlineAt);
  // A crash between committing a user Timeline row and its callback must not manufacture a negative.
  const storedReply = context.db.prepare(`SELECT created_at FROM timeline_messages WHERE character_id=:character
    AND role='user' AND seq>:seq AND created_at>=:published AND created_at<:deadline AND created_at<=:at LIMIT 1`)
    .get({ character: record.characterId, seq: record.timelineSeq, published: record.publishedAt, deadline: record.deadlineAt, at: new Date(at).toISOString() });
  if (beforeDeadline && !storedReply) return;
  const disposition = storedReply ? "engaged"
    : record.opportunityMs >= FEEDBACK_OPPORTUNITY_MS ? "weak_non_engagement" : "unknown";
  const occurredAt = new Date(at).toISOString();
  context.db.prepare(`UPDATE initiative_feedback SET disposition=:disposition,settled_at=:at
    WHERE delivery_id=:id AND disposition IS NULL`).run({ disposition, at: occurredAt, id: record.deliveryId });
  emit({ kind: "delivery.feedback_settled", deliveryId: record.deliveryId, runId: record.runId,
    attemptId: record.attemptId, characterId: record.characterId, timelineSeq: record.timelineSeq,
    opportunityMs: record.opportunityMs, occurredAt, disposition });
}

function readRecord(row: SqlRow): FeedbackRecord {
  return FeedbackRecordSchema.parse({ deliveryId: row.delivery_id, runId: row.run_id, attemptId: row.attempt_id,
    characterId: row.character_id, timelineSeq: row.timeline_seq, publishedAt: row.published_at,
    deadlineAt: row.deadline_at, opportunityMs: row.opportunity_ms, intervals: JSON.parse(String(row.intervals_json)),
    disposition: row.disposition, settledAt: row.settled_at });
}
