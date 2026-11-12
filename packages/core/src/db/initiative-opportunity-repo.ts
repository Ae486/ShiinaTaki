/**
 * INPUT: trusted stable opportunity identity, canonical Run link and model intent transaction
 * OUTPUT: Core-wide hourly reservations and exactly-once first-model charges independent of speech
 * POS: core/db — policy accounting subordinate to Runs; no second execution or recovery ledger
 */
import type { Database } from "./sqlite.ts";

export interface InitiativeOpportunityRepo {
  reserve(input: { key: string; expiresAt: string; hourLimit: number }): boolean;
  link(key: string, runId: string): void;
  charge(key: string, hourLimit: number): void;
  release(key: string): void;
}

export function createInitiativeOpportunityRepo(db: Database, now: () => string = () => new Date().toISOString()): InitiativeOpportunityRepo {
  const get = (key: string) => db.prepare("SELECT * FROM initiative_model_opportunities WHERE opportunity_key=:key").get({ key });
  return {
    reserve(input) {
      let reserved = false;
      // Shared manifests accept offset timestamps; lexical SQLite windows require one UTC representation.
      const expiresAt = new Date(input.expiresAt).toISOString();
      db.transaction(() => {
        const existing = get(input.key);
        // Consumed identity remains consumed, including a cancelled/failed Run. No fresh model is minted on retry.
        if (existing?.run_id || existing?.charged_at) { reserved = true; return; }
        const at = now();
        if (existing?.state === "reserved" && String(existing.expires_at) > at) return;
        if (countCapacity(db, at) >= input.hourLimit || expiresAt <= at) return;
        db.prepare(`INSERT INTO initiative_model_opportunities(opportunity_key,state,reserved_at,expires_at)
          VALUES(:key,'reserved',:at,:expiresAt) ON CONFLICT(opportunity_key) DO UPDATE
          SET state='reserved',reserved_at=:at,expires_at=:expiresAt`)
          .run({ key: input.key, at, expiresAt });
        reserved = true;
      });
      return reserved;
    },
    link(key, runId) {
      const result = db.prepare(`UPDATE initiative_model_opportunities SET run_id=:runId
        WHERE opportunity_key=:key AND (run_id IS NULL OR run_id=:runId)`).run({ key, runId });
      if (result.changes !== 1) throw new Error("INITIATIVE_OPPORTUNITY_CONFLICT");
    },
    charge(key, hourLimit) {
      const current = get(key); const at = now();
      if (current?.charged_at) return;
      if (!current?.run_id || current.state !== "reserved" || String(current.expires_at) <= at
        || countCapacity(db, at) > hourLimit) throw new Error("INITIATIVE_MODEL_BUDGET");
      // Called only from the Effect repo's synchronous intent transaction; a failed intent rolls this back.
      db.prepare(`UPDATE initiative_model_opportunities SET state='charged',charged_at=:at
        WHERE opportunity_key=:key AND state='reserved'`).run({ key, at });
    },
    release(key) {
      db.prepare("UPDATE initiative_model_opportunities SET state='released' WHERE opportunity_key=:key AND charged_at IS NULL")
        .run({ key });
    },
  };
}

function countCapacity(db: Database, at: string): number {
  const hourStart = new Date(Date.parse(at) - 3_600_000).toISOString();
  const row = db.prepare(`SELECT count(*) AS count FROM initiative_model_opportunities
    WHERE charged_at>:hourStart OR (state='reserved' AND expires_at>:at)`).get({ hourStart, at });
  return Number(row?.count ?? 0);
}
