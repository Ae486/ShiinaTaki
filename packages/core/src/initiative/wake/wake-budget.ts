/**
 * INPUT: canonical C1 model reservations/publication charges and effective user policy
 * OUTPUT: read-only early refusal before context/model work; no reservations or refunds
 * POS: core/initiative/wake — C1 remains the final transactional accounting authority
 */
import type { Database } from "../../db/sqlite.ts";
import type { InitiativePolicy } from "../../config/initiative-policy-config.ts";
import type { InitiativeWakePolicy } from "../../config/initiative-wake-config.ts";
import type { InitiativeWakeReason } from "@taki/shared";
import { startOfUserDay } from "../../time/time-context.ts";
import { deterministicChance } from "./wake-matcher.ts";

export function readWakeBudget(db: Database, input: {
  now: number; timezone: string; policy: InitiativePolicy; wake: InitiativeWakePolicy;
}): InitiativeWakeReason | undefined {
  const at = new Date(input.now).toISOString();
  const hourStart = new Date(input.now - 3_600_000).toISOString();
  const capacity = db.prepare(`SELECT count(*) AS count FROM initiative_model_opportunities
    WHERE charged_at>:hourStart OR (state='reserved' AND expires_at>:at)`).get({ hourStart, at });
  if (Number(capacity?.count ?? 0) >= input.policy.modelHourLimit) return "model-budget";
  const last = db.prepare("SELECT opportunity_key,charged_at FROM initiative_model_opportunities WHERE charged_at IS NOT NULL ORDER BY charged_at DESC LIMIT 1").get();
  if (last) {
    const jitter = (deterministicChance(String(last.opportunity_key)) * 2 - 1) * input.wake.jitterRatio;
    const gap = Math.max(300_000, input.wake.modelCadenceMs * (1 + jitter));
    if (input.now - Date.parse(String(last.charged_at)) < gap) return "model-cadence";
  }
  return readUtteranceBudget(db, input);
}

export function readUtteranceBudget(db: Database, input: {
  now: number; timezone: string; policy: InitiativePolicy;
}): InitiativeWakeReason | undefined {
  const hourStart = new Date(input.now - 3_600_000).toISOString();
  const hourly = db.prepare("SELECT count(*) AS n FROM run_deliveries WHERE delivery_class='class_b' AND charged_at>=:hourStart").get({ hourStart });
  if (Number(hourly?.n ?? 0) >= input.policy.utteranceHourLimit || dailyCount(db, input) >= input.policy.utteranceDayLimit) return "utterance-budget";
  const last = db.prepare("SELECT max(charged_at) AS last FROM run_deliveries WHERE delivery_class='class_b'").get()?.last;
  if (last && input.now - Date.parse(String(last)) < input.policy.utteranceGapMs) return "utterance-gap";
  return undefined;
}

function dailyCount(db: Database, input: { now: number; timezone: string }): number {
  const dayStart = startOfUserDay(input.now, input.timezone);
  const priorDay = new Date(input.now - 86_400_000).toISOString();
  const zones = db.prepare("SELECT DISTINCT charge_timezone AS zone FROM run_deliveries WHERE delivery_class='class_b' AND charged_at IS NOT NULL").all();
  return zones.reduce((total, row) => {
    const zone = row.zone === null ? input.timezone : String(row.zone);
    // Same conservative carry as the final C1 writer: switching target/timezone cannot mint capacity.
    const boundary = zone === input.timezone ? dayStart
      : [priorDay, startOfUserDay(input.now, zone)].reduce((earliest, value) => value < earliest ? value : earliest, dayStart);
    const count = db.prepare(`SELECT count(*) AS n FROM run_deliveries WHERE delivery_class='class_b'
      AND charge_timezone IS :zone AND charged_at>=:boundary`).get({ zone: row.zone ?? null, boundary });
    return total + Number(count?.n ?? 0);
  }, 0);
}
