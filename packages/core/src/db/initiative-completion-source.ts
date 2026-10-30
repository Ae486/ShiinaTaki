/**
 * INPUT: canonical terminal Runs and Class A delivery facts
 * OUTPUT: bounded actual background completion facts and readable setup choices
 * POS: core/db — read-only source projection; never derives triggers from generated prose
 */
import { InitiativeCompletionFactSchema, type InitiativeCompletionFact } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export function createInitiativeCompletionSource(db: Database) {
  const read = (characterId: string, at = Date.now()): InitiativeCompletionFact[] => {
    const rows = db.prepare(`SELECT r.run_id,r.character_id,r.terminal_at,r.initiator,r.parent_run_id,
      EXISTS(SELECT 1 FROM run_deliveries d WHERE d.run_id=r.run_id AND d.delivery_class='class_a'
        AND (d.timeline_seq IS NOT NULL OR d.charged_at IS NOT NULL)) AS delivered
      FROM runs r WHERE r.character_id=:characterId AND r.state='completed'
      AND r.initiator IN ('scheduled','subagent','webhook') AND r.terminal_at>=:since
      ORDER BY r.terminal_at DESC,r.run_id LIMIT 40`).all({ characterId, since: new Date(at - 86_400_000).toISOString() });
    return rows.flatMap((row) => {
      const fact = InitiativeCompletionFactSchema.safeParse({ runId: row.run_id, characterId: row.character_id,
        completedAt: typeof row.terminal_at === "string" ? Date.parse(row.terminal_at) : NaN,
        initiator: row.initiator, causeRunId: row.parent_run_id, deliveredClassA: row.delivered === 1 });
      return fact.success && fact.data.completedAt <= at ? [fact.data] : [];
    });
  };
  return { read, choices: (characterId: string) => read(characterId).filter((fact) => !fact.deliveredClassA)
    .map((fact) => ({ runId: fact.runId, label: `${fact.initiator === "scheduled" ? "定时任务" : "后台任务"} · ${new Date(fact.completedAt).toISOString()}` })) };
}
