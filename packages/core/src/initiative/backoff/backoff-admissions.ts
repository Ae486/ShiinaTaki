/**
 * INPUT: canonical admitted Class B Runs and the effective User Timezone
 * OUTPUT: read-only daily usage/spacing bounds plus immutable admission timezone capture
 * POS: core/initiative/backoff — admission metadata only; Run and model ledgers remain authoritative
 */
import { UserTimezoneNameSchema } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { startOfUserDay } from "../../time/time-context.ts";

const DAY_MS = 86_400_000;
// Same civil-day search bound as core/time/startOfUserDay. This is a conservative
// bound for missing historical metadata, not a new model cadence calibration.
const CIVIL_DAY_BOUND_MS = 2 * DAY_MS;
export interface BackoffAdmissions { dailyJudgments: number; dailyUntil?: number; lastAt?: number }

export function readBackoffAdmissions(db: Database, input: {
  characterId: string; now: number; timezone: string;
}): BackoffAdmissions {
  const zone = UserTimezoneNameSchema.parse(input.timezone);
  const currentStart = startOfUserDay(input.now, zone);
  const zones = db.prepare(`SELECT initiative_timezone AS zone,max(queued_at) AS last FROM runs
    WHERE character_id=:characterId AND delivery_class='class_b' AND initiator='heartbeat' GROUP BY initiative_timezone`)
    .all({ characterId: input.characterId });
  let dailyJudgments = 0; let dailyUntil: number | undefined; let lastAt: number | undefined;
  for (const row of zones) {
    const last = Date.parse(String(row.last));
    lastAt = Math.max(lastAt ?? last, last);
    const originalZone = row.zone === null ? undefined : UserTimezoneNameSchema.parse(row.zone);
    const boundary = originalZone === undefined ? new Date(input.now - CIVIL_DAY_BOUND_MS).toISOString()
      : originalZone === zone ? currentStart : [currentStart, startOfUserDay(input.now, originalZone),
        new Date(input.now - DAY_MS).toISOString()].sort()[0];
    const count = Number(db.prepare(`SELECT count(*) AS n FROM runs WHERE character_id=:characterId
      AND delivery_class='class_b' AND initiator='heartbeat' AND initiative_timezone IS :zone AND queued_at>=:boundary`)
      .get({ characterId: input.characterId, zone: row.zone ?? null, boundary: boundary ?? currentStart })?.n ?? 0);
    if (!count) continue;
    dailyJudgments += count;
    const until = originalZone === undefined ? Math.max(last + CIVIL_DAY_BOUND_MS, endOfDay(last, zone))
      : Math.max(endOfDay(last, zone), endOfDay(last, originalZone), originalZone === zone ? 0 : last + DAY_MS);
    dailyUntil = Math.max(dailyUntil ?? until, until);
  }
  return { dailyJudgments, ...(dailyUntil === undefined ? {} : { dailyUntil }), ...(lastAt === undefined ? {} : { lastAt }) };
}

export function captureBackoffAdmission(db: Database, input: { runId: string; timezone: string }): void {
  const timezone = UserTimezoneNameSchema.parse(input.timezone);
  const row = db.prepare("SELECT delivery_class,initiator,initiative_timezone FROM runs WHERE run_id=:runId").get({ runId: input.runId });
  if (!row || row.delivery_class !== "class_b" || row.initiator !== "heartbeat") throw new Error("BACKOFF_ADMISSION_REQUIRED");
  if (row.initiative_timezone !== null && row.initiative_timezone !== timezone) throw new Error("BACKOFF_ADMISSION_CONFLICT");
  db.prepare("UPDATE runs SET initiative_timezone=:timezone WHERE run_id=:runId AND initiative_timezone IS NULL")
    .run({ runId: input.runId, timezone });
}

function endOfDay(at: number, timezone: string): number {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const day = format.format(at);
  let lower = at; let upper = at + CIVIL_DAY_BOUND_MS;
  while (lower + 1 < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (format.format(middle) === day) lower = middle;
    else upper = middle;
  }
  return upper;
}
