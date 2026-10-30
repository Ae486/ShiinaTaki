/**
 * INPUT: settled structural decisions, original Run identity and current publication policy
 * OUTPUT: immutable delivery records, Run-bound atomic Timeline/budget publication and required business events
 * POS: core/db — subordinate to Run/Attempt and ordinary Timeline; no transport inside transactions
 */
import { randomUUID } from "node:crypto";
import { DeliveryRecordSchema, InitiativePolicyStatusSchema, type DeliveryRecord, type HeartbeatDecision,
  type InitiativeEventPayload, type InitiativePolicyStatus, type RunEvent, type TimelineEntry } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import type { RunEventRepo } from "./run-event-repo.ts";
import type { RunEventLiveBus } from "./run-event-live.ts";
import { startOfUserDay } from "../time/time-context.ts";

export interface DeliveryPolicy { hourLimit: number; dayLimit: number; gapMs: number; dayStart: string; timezone: string }
export interface DeliveryStage {
  runId: string; attemptId: string; characterId: string; deliveryClass: "class_a" | "class_b";
  decision: HeartbeatDecision; expiresAt: string; primaryVersion: number; consideredCount: number;
}
export interface RunDeliveryRepo {
  get(runId: string): DeliveryRecord | undefined;
  held(characterId: string): DeliveryRecord | undefined;
  stage(input: DeliveryStage): DeliveryRecord;
  transition(input: { runId: string; expectedVersion: number; state?: DeliveryRecord["state"];
    continuation?: DeliveryRecord["continuation"]; fact: Omit<InitiativeEventPayload, "deliveryId"> }): DeliveryRecord | undefined;
  commitPublication(input: { runId: string; policy: DeliveryPolicy; append(characterId: string, text: string): TimelineEntry;
    /** Pure synchronous final authority check; callbacks returning anything except true refuse publication. */
    isCurrent?(record: DeliveryRecord): boolean }): TimelineEntry | undefined;
  policy(characterId: string): InitiativePolicyStatus;
  notePolicy(characterId: string, reason: InitiativePolicyStatus["recent"][number]["reason"]): void;
  pending(): DeliveryRecord[];
}

export function createRunDeliveryRepo(input: { db: Database; events: RunEventRepo; live?: RunEventLiveBus; now?: () => string }): RunDeliveryRepo {
  const { db } = input; const now = input.now ?? (() => new Date().toISOString());
  const get = (runId: string): DeliveryRecord | undefined => {
    const row = db.prepare("SELECT * FROM run_deliveries WHERE run_id=:runId").get({ runId });
    return row ? DeliveryRecordSchema.parse({ deliveryId: row.delivery_id, runId: row.run_id, attemptId: row.attempt_id,
      characterId: row.character_id, deliveryClass: row.delivery_class, version: row.version, decision: JSON.parse(String(row.decision_json)),
      expiresAt: row.expires_at, state: row.state, continuation: row.continuation, primaryVersion: row.primary_version,
      timelineSeq: row.timeline_seq, chargedAt: row.charged_at, createdAt: row.created_at }) : undefined;
  };
  const commit = (write: (facts: RunEvent[]) => void) => {
    const facts: RunEvent[] = []; db.transaction(() => write(facts)); input.live?.publish(facts);
  };
  const event = (record: DeliveryRecord, payload: Omit<InitiativeEventPayload, "deliveryId">) => input.events.append({
    runId: record.runId, attemptId: record.attemptId, schemaVersion: "run-event.v2", category: "lifecycle",
    kind: payload.kind, occurredAt: now(), source: "core.delivery", payload: { ...payload, deliveryId: record.deliveryId },
  });
  const context = { db, get, now, commit, event };
  return {
    get,
    held: (characterId) => readHeldDelivery(context, characterId),
    stage: (candidate) => stageDelivery(context, candidate),
    transition(change) {
      let updated: DeliveryRecord | undefined;
      commit((facts) => {
        const current = get(change.runId);
        if (!current || current.version !== change.expectedVersion) return;
        const result = db.prepare(`UPDATE run_deliveries SET version=version+1,state=:state,continuation=:continuation
          WHERE run_id=:runId AND version=:version`).run({ runId: current.runId, version: current.version,
          state: change.state ?? current.state, continuation: change.continuation ?? current.continuation });
        if (result.changes !== 1) return;
        facts.push(event(current, change.fact)); updated = get(current.runId);
      });
      return updated;
    },
    commitPublication: (args) => commitPublication(context, args),
    policy: (characterId) => InitiativePolicyStatusSchema.parse({ characterId, recent: db.prepare(
      "SELECT reason,occurred_at FROM initiative_policy_facts WHERE character_id=:characterId ORDER BY seq DESC LIMIT 100"
    ).all({ characterId }).map((row) => ({ reason: row.reason, occurredAt: row.occurred_at })) }),
    notePolicy(characterId, reason) {
      db.transaction(() => {
        db.prepare("INSERT INTO initiative_policy_facts(character_id,reason,occurred_at) VALUES(:characterId,:reason,:at)").run({ characterId, reason, at: now() });
        db.prepare(`DELETE FROM initiative_policy_facts WHERE character_id=:characterId AND seq NOT IN
          (SELECT seq FROM initiative_policy_facts WHERE character_id=:characterId ORDER BY seq DESC LIMIT 100)`).run({ characterId });
      });
    },
    pending: () => db.prepare("SELECT run_id FROM run_deliveries WHERE state IN ('staged','held','dispatch_committed') LIMIT 1000").all()
      .flatMap((row) => { const value = get(String(row.run_id)); return value ? [value] : []; }),
  };
}

interface DeliveryWriteContext {
  db: Database;
  get: RunDeliveryRepo["get"];
  now(): string;
  commit(write: (facts: RunEvent[]) => void): void;
  event(record: DeliveryRecord, payload: Omit<InitiativeEventPayload, "deliveryId">): RunEvent;
}

function stageDelivery(context: DeliveryWriteContext, candidate: DeliveryStage): DeliveryRecord {
  const { db, get, now, commit, event } = context;
  const existing = get(candidate.runId);
  if (existing) {
    if (existing.attemptId !== candidate.attemptId || JSON.stringify(existing.decision) !== JSON.stringify(candidate.decision)) throw new Error("DELIVERY_CONFLICT");
    return existing;
  }
  const { consideredCount, ...stage } = candidate;
  const record = DeliveryRecordSchema.parse({ ...stage, deliveryId: randomUUID(), version: 0,
    state: "staged", continuation: candidate.decision.outcome !== "silent" && candidate.decision.presentation ? "pending" : "none",
    timelineSeq: null, chargedAt: null, createdAt: now() });
  commit((facts) => {
    const run = db.prepare("SELECT state,active_attempt_id,character_id,delivery_class FROM runs WHERE run_id=:runId").get({ runId: record.runId });
    if (run?.state !== "running" || run.active_attempt_id !== record.attemptId || run.character_id !== record.characterId
      || run.delivery_class !== record.deliveryClass) throw new Error("DELIVERY_RUN_REFUSED");
    db.prepare(`INSERT INTO run_deliveries (delivery_id,run_id,attempt_id,character_id,delivery_class,decision_json,
      expires_at,state,continuation,primary_version,created_at) VALUES
      (:id,:runId,:attemptId,:characterId,:class,:decision,:expiresAt,'staged',:continuation,:primary,:at)`)
      .run({ id: record.deliveryId, runId: record.runId, attemptId: record.attemptId, characterId: record.characterId,
        class: record.deliveryClass, decision: JSON.stringify(record.decision), expiresAt: record.expiresAt,
        continuation: record.continuation, primary: record.primaryVersion, at: record.createdAt });
    facts.push(event(record, { kind: "initiative.decision", state: "committed", outcome: record.decision.outcome,
      selectedCount: record.decision.selectedCandidateIds.length, consideredCount }));
    facts.push(event(record, { kind: "delivery.staged", state: "staged" }));
  });
  return record;
}

function commitPublication(context: DeliveryWriteContext, args: Parameters<RunDeliveryRepo["commitPublication"]>[0]): TimelineEntry | undefined {
  const { db, get, now, commit, event } = context;
  let entry: TimelineEntry | undefined;
  commit((facts) => {
    const current = get(args.runId); const at = now();
    if (!current || current.decision.outcome !== "speak" || current.timelineSeq !== null
      || !["staged", "held"].includes(current.state)) return;
    if (Date.parse(at) >= Date.parse(current.expiresAt)) throw new Error("DELIVERY_EXPIRED");
    // Staging can precede an Attempt replacement. Terminal Run state alone must not publish the old decision,
    // and a mismatched retained Character/class must never reroute speech or bypass Class B accounting.
    const run = db.prepare("SELECT state,active_attempt_id,character_id,delivery_class FROM runs WHERE run_id=:runId").get({ runId: current.runId });
    if (!["completed", "failed", "outcome_unknown"].includes(String(run?.state))
      || run?.active_attempt_id !== current.attemptId || run.character_id !== current.characterId
      || run.delivery_class !== current.deliveryClass) throw new Error("DELIVERY_RUN_REFUSED");
    if (args.isCurrent && args.isCurrent(current) !== true) throw new Error("DELIVERY_SOURCE_REFUSED");
    if (current.deliveryClass === "class_b") checkBudget(db, args.policy, at);
    entry = args.append(current.characterId, current.decision.text);
    db.prepare(`UPDATE run_deliveries SET version=version+1,state='dispatch_committed',timeline_seq=:seq,charged_at=:at,charge_timezone=:zone
      WHERE run_id=:runId AND version=:version`).run({ seq: entry.seq, at, zone: args.policy.timezone, runId: current.runId, version: current.version });
    facts.push(event(current, { kind: "delivery.dispatch_committed", state: "dispatch_committed" }));
  });
  return entry;
}

function checkBudget(db: Database, policy: DeliveryPolicy, at: string): void {
  const hourStart = new Date(Date.parse(at) - 3_600_000).toISOString();
  const row = db.prepare(`SELECT count(*) AS hourly FROM run_deliveries
    WHERE delivery_class='class_b' AND charged_at>=:hourStart`).get({ hourStart });
  const latest = db.prepare("SELECT max(charged_at) AS latest FROM run_deliveries WHERE delivery_class='class_b'").get()?.latest;
  if (latest && Date.parse(at) - Date.parse(String(latest)) < policy.gapMs) throw new Error("DELIVERY_GAP");
  if (countDailyCharges(db, policy, at) >= policy.dayLimit || Number(row?.hourly ?? 0) >= policy.hourLimit) throw new Error("DELIVERY_BUDGET");
}

function readHeldDelivery(context: DeliveryWriteContext, characterId: string): DeliveryRecord | undefined {
  const row = context.db.prepare("SELECT run_id FROM run_deliveries WHERE character_id=:characterId AND state='held'").get({ characterId });
  return row ? context.get(String(row.run_id)) : undefined;
}

function countDailyCharges(db: Database, policy: DeliveryPolicy, at: string): number {
  const priorDay = new Date(Date.parse(at) - 86_400_000).toISOString();
  const zones = db.prepare(`SELECT DISTINCT charge_timezone AS zone FROM run_deliveries
    WHERE delivery_class='class_b' AND charged_at IS NOT NULL`).all();
  return zones.reduce((total, row) => {
    const zone = row.zone === null ? policy.timezone : String(row.zone);
    // Preserve the existing conservative 24-hour carry, plus the full original civil day when DST
    // makes it longer. A zone change must not turn a still-consumed day allowance into fresh capacity.
    const boundary = zone === policy.timezone ? policy.dayStart
      : [priorDay, startOfUserDay(Date.parse(at), zone)].reduce((earliest, value) => value < earliest ? value : earliest, policy.dayStart);
    const count = db.prepare(`SELECT count(*) AS n FROM run_deliveries WHERE delivery_class='class_b'
      AND charge_timezone IS :zone AND charged_at>=:boundary`).get({ zone: row.zone ?? null, boundary });
    return total + Number(count?.n ?? 0);
  }, 0);
}
