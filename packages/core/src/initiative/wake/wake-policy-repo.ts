/**
 * INPUT: source claims, canonical Run identity and validated policy dispositions
 * OUTPUT: durable occurrence dedupe, crash-cut reconciliation and bounded same-Monitor facts
 * POS: core/initiative/wake — subordinate source bindings; Run/Effect ledgers retain execution and charges
 */
import { z } from "zod";
import type { Database } from "../../db/sqlite.ts";
import { InitiativeWakeEvaluationSchema, InitiativeWakePolicyStatusSchema,
  type InitiativeWakeEvaluation, type InitiativeWakePolicyStatus, type InitiativeWakeReason } from "@taki/shared";
import type { WakeSelection } from "./wake-contract.ts";
import { wakeDigest } from "./wake-matcher.ts";

const PatternReferences = z.array(z.strictObject({ patternId: z.string().min(1).max(200),
  revisionId: z.string().min(1).max(200) })).max(4);
export interface WakePolicyRepo {
  claimed(sourceKey: string): boolean;
  claim(selection: WakeSelection): boolean;
  settle(opportunityId: string, runId?: string): void;
  releaseUnadmitted(opportunityId: string): boolean;
  reconcile(): void;
  lastPatternJudgment(patternId: string): number | undefined;
  note(characterId: string, evaluation: InitiativeWakeEvaluation): boolean;
  read(characterId: string): InitiativeWakePolicyStatus;
}
export function createWakePolicyRepo(db: Database, now: () => number): WakePolicyRepo {
  return {
    claimed: (sourceKey) => db.prepare("SELECT 1 FROM initiative_wake_claims WHERE source_key=:sourceKey").get({ sourceKey }) !== undefined,
    claim(selection) {
      const refs = PatternReferences.parse(selection.candidates.flatMap((candidate) => candidate.kind === "pattern"
        ? [{ patternId: candidate.patternId, revisionId: candidate.revisionId }] : []));
      return db.prepare(`INSERT INTO initiative_wake_claims(source_key,opportunity_id,canonical_key,character_id,
        pattern_refs_json,created_at,expires_at,disposition) VALUES(:sourceKey,:id,:canonicalKey,:characterId,:refs,:at,:expiresAt,'pending')
        ON CONFLICT(source_key) DO NOTHING`).run({ sourceKey: selection.sourceKey, id: selection.opportunityId,
        canonicalKey: canonicalWakeKey(selection.characterId, selection.opportunityId), characterId: selection.characterId,
        refs: JSON.stringify(refs), at: new Date(selection.capturedAt).toISOString(), expiresAt: new Date(selection.expiresAt).toISOString() }).changes === 1;
    },
    settle(opportunityId, runId) {
      // Admission may commit before its callback returns or throws. Query canonical identity before releasing anything.
      db.prepare(`UPDATE initiative_wake_claims SET run_id=COALESCE(:runId,(SELECT run_id FROM runs WHERE idempotency_key=canonical_key)),
        disposition=CASE WHEN COALESCE(:runId,(SELECT run_id FROM runs WHERE idempotency_key=canonical_key)) IS NULL
        THEN 'retired' ELSE 'admitted' END WHERE opportunity_id=:id AND disposition='pending'`)
        .run({ id: opportunityId, runId: runId ?? null });
    },
    releaseUnadmitted(opportunityId) {
      // A due Intention may try again inside its ORIGINAL window after a known pre-admission refusal.
      // A committed or uncertain canonical Run is never released or replayed by this source reservation.
      return db.prepare(`DELETE FROM initiative_wake_claims WHERE opportunity_id=:id AND disposition='pending'
        AND run_id IS NULL AND NOT EXISTS(SELECT 1 FROM runs WHERE idempotency_key=canonical_key)`)
        .run({ id: opportunityId }).changes === 1;
    },
    reconcile() {
      // Lost process-local context is never recaptured. New occurrences remain independent of these tombstones.
      db.prepare(`UPDATE initiative_wake_claims SET run_id=(SELECT run_id FROM runs WHERE idempotency_key=canonical_key),
        disposition=CASE WHEN EXISTS(SELECT 1 FROM runs WHERE idempotency_key=canonical_key) THEN 'admitted' ELSE 'retired' END
        WHERE disposition='pending'`).run();
    },
    lastPatternJudgment(patternId) {
      const row = db.prepare(`SELECT max(r.queued_at) AS last FROM initiative_wake_claims c JOIN runs r ON r.run_id=c.run_id,
        json_each(c.pattern_refs_json) p WHERE json_extract(p.value,'$.patternId')=:patternId`).get({ patternId });
      return typeof row?.last === "string" ? Date.parse(row.last) : undefined;
    },
    note: (characterId, evaluation) => noteEvaluation(db, characterId, evaluation),
    read(characterId) {
      // Seven UTC calendar buckets, including today. Expose the actual boundary instead of
      // presenting a midnight bucket as an exact rolling seven-day measurement.
      const since = `${new Date(now() - 6 * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`;
      const rows = db.prepare(`SELECT * FROM initiative_wake_evaluations WHERE character_id=:characterId ORDER BY seq DESC LIMIT 100`).all({ characterId });
      const counters = db.prepare(`SELECT reason,sum(count) AS count FROM initiative_wake_counters
        WHERE character_id=:characterId AND bucket>=:since GROUP BY reason`).all({ characterId, since: since.slice(0, 10) });
      return compatibleStatus(InitiativeWakePolicyStatusSchema.parse({ characterId, cursor: Number(rows[0]?.seq ?? 0), since,
        recent: rows.map((row) => ({ reason: row.reason, occurredAt: row.occurred_at, matchedCount: row.matched_count, source: row.source })),
        counters: counters.map((row) => ({ reason: row.reason, count: Number(row.count) })) }));
    },
  };
}
function compatibleStatus(status: InitiativeWakePolicyStatus): InitiativeWakePolicyStatus {
  // This RPC predates detailed backoff. Preserve every diagnostic row/cursor and the old
  // closed vocabulary; the separately versioned backoff RPC exposes the exact current cause.
  const reason = (value: InitiativeWakeReason): InitiativeWakeReason => value === "backoff-spacing" ? "model-cadence"
    : value === "backoff-daily" ? "model-budget" : value;
  const counters = new Map<InitiativeWakeReason, number>();
  for (const counter of status.counters) {
    const key = reason(counter.reason);
    counters.set(key, (counters.get(key) ?? 0) + counter.count);
  }
  return InitiativeWakePolicyStatusSchema.parse({ ...status,
    // The legacy Monitor's closed source vocabulary has one observation category. Keep the precise
    // media source in durable diagnostics while projecting it as activity for that existing RPC.
    recent: status.recent.map((entry) => ({ ...entry, source: entry.source === "media" ? "activity" : entry.source, reason: reason(entry.reason) })),
    counters: [...counters].map(([key, count]) => ({ reason: key, count })) });
}
function noteEvaluation(db: Database, characterId: string, candidate: InitiativeWakeEvaluation): boolean {
  const evaluation = InitiativeWakeEvaluationSchema.parse(candidate);
  let changed = false;
  db.transaction(() => {
    db.prepare("DELETE FROM initiative_wake_counters WHERE bucket<:oldest").run({
      oldest: new Date(Date.parse(evaluation.occurredAt) - 6 * 86_400_000).toISOString().slice(0, 10) });
    const last = db.prepare("SELECT * FROM initiative_wake_evaluations WHERE character_id=:characterId ORDER BY seq DESC LIMIT 1").get({ characterId });
    // Routine cadence/source renewals coalesce; counters represent policy transitions, not sampling ticks.
    if (last?.reason === evaluation.reason && last.source === evaluation.source && last.matched_count === evaluation.matchedCount) return;
    db.prepare(`INSERT INTO initiative_wake_evaluations(character_id,reason,source,matched_count,occurred_at)
      VALUES(:characterId,:reason,:source,:matched,:at)`).run({ characterId, reason: evaluation.reason,
      source: evaluation.source, matched: evaluation.matchedCount, at: evaluation.occurredAt });
    db.prepare(`DELETE FROM initiative_wake_evaluations WHERE character_id=:characterId AND seq NOT IN
      (SELECT seq FROM initiative_wake_evaluations WHERE character_id=:characterId ORDER BY seq DESC LIMIT 100)`).run({ characterId });
    db.prepare(`INSERT INTO initiative_wake_counters(character_id,bucket,reason,count) VALUES(:characterId,:bucket,:reason,1)
      ON CONFLICT(character_id,bucket,reason) DO UPDATE SET count=count+1`).run({ characterId,
      bucket: evaluation.occurredAt.slice(0, 10), reason: evaluation.reason });
    changed = true;
  });
  return changed;
}
export function canonicalWakeKey(characterId: string, opportunityId: string): string {
  return `initiative:${wakeDigest(`${characterId}\n${opportunityId}`)}`;
}
