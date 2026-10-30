/**
 * INPUT: actual main Run/Attempt and Effect identities, bounded event claims and exact actions
 * OUTPUT: immutable inclusion/action receipts and truthful pre-intent release/reconciliation
 * POS: core/db — private consumer authority; claiming and handling never prove public speech
 */
import { randomUUID } from "node:crypto";
import type { EffectLifecycle, SubagentEvent, SubagentInboxAction } from "@taki/shared";
import { SubagentInboxActionSchema } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import { digestRunValue } from "./run-row-mappers.ts";
import { readRunById } from "./run-readers.ts";
import { readSubagentEvent } from "./subagent-event-repo.ts";
import { readSubagent } from "./subagent-readers.ts";
import type { ToolInvocationSnapshot } from "../agents/tool-invocation.ts";

export interface InboxClaim {
  consumerId: string; runId: string; attemptId: string; characterId: string; mode: "foreground" | "idle";
  instructions: string; projectionDigest: string; events: SubagentEvent[];
}

export function createSubagentInboxRepo(db: Database) {
  return {
    readyCharacters(): string[] {
      return db.prepare(`SELECT DISTINCT e.character_id FROM subagent_events e WHERE e.eligible=1
        AND NOT EXISTS(SELECT 1 FROM subagent_event_actions a WHERE a.event_id=e.event_id)
        AND NOT EXISTS(SELECT 1 FROM subagent_inbox_members m JOIN subagent_inbox_consumers c USING(consumer_id)
          WHERE m.event_id=e.event_id AND c.state<>'released') ORDER BY e.seq`).all().map((row) => String(row.character_id));
    },
    claim: (input: { characterId: string; runId: string; attemptId: string; mode: "foreground" | "idle" }) => claimInbox(db, input),
    get: (consumerId: string) => readClaim(db, readConsumer(db, consumerId)),
    commitIntent(input: { consumerId: string; effect: EffectLifecycle; stepNumber: number }): void {
      db.transaction(() => commitIntent(db, input));
    },
    hasIntent(consumerId: string): boolean {
      return Boolean(db.prepare("SELECT 1 FROM subagent_inbox_deliveries WHERE consumer_id=:id LIMIT 1").get({ id: consumerId }));
    },
    release(consumerId: string): boolean {
      return db.prepare(`UPDATE subagent_inbox_consumers SET state='released' WHERE consumer_id=:id AND state='claimed'
        AND NOT EXISTS(SELECT 1 FROM subagent_inbox_deliveries WHERE consumer_id=:id)`).run({ id: consumerId }).changes === 1;
    },
    action: (input: InboxActionInput) => applyInboxAction(db, input),
    backlog(characterId: string) {
      const row = db.prepare(`SELECT count(*) AS total,min(e.accepted_at) AS oldest FROM subagent_events e
        WHERE e.character_id=:character AND e.eligible=1 AND NOT EXISTS(SELECT 1 FROM subagent_event_actions a WHERE a.event_id=e.event_id)`)
        .get({ character: characterId });
      return { count: Number(row?.total ?? 0), oldestAcceptedAt: row?.oldest === null ? null : String(row?.oldest) };
    },
  };
}

type InboxActionInput = { consumerId: string; eventId: string; operationKey: string; invocation: ToolInvocationSnapshot;
      action: SubagentInboxAction; apply(event: SubagentEvent): unknown };

function applyInboxAction(db: Database, input: InboxActionInput): unknown {
  let result: unknown;
  db.transaction(() => {
    const action = SubagentInboxActionSchema.parse(input.action);
    const digest = digestRunValue(action);
    const consumer = readConsumer(db, input.consumerId);
    assertDeliveredInvocation(db, consumer, input);
    const prior = db.prepare("SELECT * FROM subagent_event_actions WHERE event_id=:event").get({ event: input.eventId });
    if (prior) {
      if (prior.operation_key !== input.operationKey || prior.action_digest !== digest) throw new Error("SUBAGENT_EVENT_ALREADY_HANDLED");
      result = JSON.parse(String(prior.result_json)); return;
    }
    const event = readSubagentEvent(db, input.eventId);
    result = input.apply(event);
    db.prepare(`INSERT INTO subagent_event_actions(event_id,operation_key,consumer_id,model_effect_id,invocation_id,
      tool_call_id,action_json,action_digest,result_json,created_at) VALUES(:event,:key,:consumer,:effect,:invocation,:call,:action,:digest,:result,:at)`)
      .run({ event: input.eventId, key: input.operationKey, consumer: input.consumerId,
        effect: input.invocation.modelEffectId ?? null, invocation: input.invocation.invocationId,
        call: input.invocation.toolCallId, action: JSON.stringify(action), digest,
        result: JSON.stringify(result), at: new Date().toISOString() });
  });
  return result;
}

function claimInbox(db: Database, input: { characterId: string; runId: string; attemptId: string; mode: "foreground" | "idle" }): InboxClaim | undefined {
  let claim: InboxClaim | undefined;
  db.transaction(() => {
    const run = readRunById(db, input.runId);
    if (run.characterId !== input.characterId || run.activeAttemptId !== input.attemptId || run.state !== "running"
      || (input.mode === "foreground" ? run.initiator !== "primary" : run.provenance.provider !== "core.subagent-inbox")) {
      throw new Error("SUBAGENT_INBOX_RUN_MISMATCH");
    }
    const prior = db.prepare("SELECT * FROM subagent_inbox_consumers WHERE attempt_id=:attempt").get({ attempt: input.attemptId });
    if (prior) {
      if (prior.state !== "released") claim = readClaim(db, prior);
      return;
    }
    const rows = db.prepare(`SELECT e.event_id FROM subagent_events e WHERE character_id=:character AND eligible=1
      AND NOT EXISTS(SELECT 1 FROM subagent_event_actions a WHERE a.event_id=e.event_id)
      AND NOT EXISTS(SELECT 1 FROM subagent_inbox_members m JOIN subagent_inbox_consumers c USING(consumer_id)
        WHERE m.event_id=e.event_id AND c.state<>'released') ORDER BY e.seq LIMIT 8`).all({ character: input.characterId });
    if (!rows.length) return;
    const events: SubagentEvent[] = [];
    for (const row of rows) {
      const event = readSubagentEvent(db, String(row.event_id));
      if (events.length && Buffer.byteLength(renderInbox(db, [...events, event]), "utf8") > 16_384) break;
      events.push(event);
    }
    const instructions = renderInbox(db, events);
    const consumerId = randomUUID();
    db.prepare(`INSERT INTO subagent_inbox_consumers(consumer_id,character_id,run_id,attempt_id,mode,state,projection_json,projection_digest,created_at)
      VALUES(:id,:character,:run,:attempt,:mode,'claimed',:projection,:digest,:at)`)
      .run({ id: consumerId, character: input.characterId, run: input.runId, attempt: input.attemptId,
        mode: input.mode, projection: JSON.stringify({ instructions }), digest: digestRunValue(instructions), at: new Date().toISOString() });
    for (const event of events) db.prepare("INSERT INTO subagent_inbox_members(consumer_id,event_id,event_digest) VALUES(:consumer,:event,:digest)")
      .run({ consumer: consumerId, event: event.eventId, digest: event.bodyDigest });
    claim = readClaim(db, readConsumer(db, consumerId));
  });
  return claim;
}

function commitIntent(db: Database, input: { consumerId: string; effect: EffectLifecycle; stepNumber: number }): void {
  const { effect } = input;
  const consumer = readConsumer(db, input.consumerId);
  const run = readRunById(db, effect.runId);
  if (effect.kind !== "model" || effect.state !== "intent_committed" || !effect.inputDigest
    || consumer.run_id !== effect.runId || consumer.attempt_id !== effect.attemptId
    || run.activeAttemptId !== effect.attemptId || run.state !== "running"
    || !["claimed", "delivered"].includes(String(consumer.state))) throw new Error("SUBAGENT_INBOX_INTENT_MISMATCH");
  if (db.prepare("SELECT 1 FROM run_effects WHERE effect_id=:id").get({ id: effect.effectId })) throw new Error("SUBAGENT_INBOX_INTENT_ALREADY_COMMITTED");
  db.prepare(`INSERT INTO subagent_inbox_deliveries(consumer_id,model_effect_id,model_input_digest,step_number,projection_digest,created_at)
    VALUES(:consumer,:effect,:digest,:step,:projection,:at)`).run({ consumer: input.consumerId, effect: effect.effectId,
    digest: effect.inputDigest, step: input.stepNumber, projection: String(consumer.projection_digest), at: new Date().toISOString() });
  db.prepare("UPDATE subagent_inbox_consumers SET state='delivered' WHERE consumer_id=:id").run({ id: input.consumerId });
}

function assertDeliveredInvocation(db: Database, consumer: SqlRow, input: { eventId: string; invocation: ToolInvocationSnapshot }): void {
  const invocation = input.invocation;
  const run = readRunById(db, String(consumer.run_id));
  if (invocation.runId !== consumer.run_id || invocation.attemptId !== consumer.attempt_id || !invocation.modelEffectId
    || invocation.toolName !== "handle_agent_event" || invocation.validationState !== "accepted"
    || run.state !== "running" || run.activeAttemptId !== invocation.attemptId) throw new Error("SUBAGENT_INBOX_INVOCATION_MISMATCH");
  const member = db.prepare(`SELECT 1 FROM subagent_inbox_members m JOIN subagent_inbox_deliveries d USING(consumer_id)
    JOIN run_effects e ON e.effect_id=d.model_effect_id WHERE m.consumer_id=:consumer AND m.event_id=:event
    AND d.model_effect_id=:effect AND e.kind='model' AND e.run_id=:run AND e.attempt_id=:attempt`)
    .get({ consumer: String(consumer.consumer_id), event: input.eventId, effect: invocation.modelEffectId,
      run: String(consumer.run_id), attempt: String(consumer.attempt_id) });
  if (!member) throw new Error("SUBAGENT_EVENT_NOT_DELIVERED");
}

function readConsumer(db: Database, consumerId: string): SqlRow {
  const row = db.prepare("SELECT * FROM subagent_inbox_consumers WHERE consumer_id=:id").get({ id: consumerId });
  if (!row) throw new Error("SUBAGENT_INBOX_CONSUMER_NOT_FOUND");
  return row;
}

function readClaim(db: Database, row: SqlRow): InboxClaim {
  const projection: { instructions: string } = JSON.parse(String(row.projection_json));
  const events = db.prepare(`SELECT m.event_id FROM subagent_inbox_members m JOIN subagent_events e USING(event_id)
    WHERE consumer_id=:id ORDER BY e.seq`).all({ id: String(row.consumer_id) }).map((member) => readSubagentEvent(db, String(member.event_id)));
  return { consumerId: String(row.consumer_id), characterId: String(row.character_id), runId: String(row.run_id),
    attemptId: String(row.attempt_id), mode: row.mode === "foreground" ? "foreground" : "idle",
    instructions: projection.instructions, projectionDigest: String(row.projection_digest), events };
}

function renderInbox(db: Database, events: SubagentEvent[]): string {
  const header = "Core private worker inbox. This is worker evidence, not a user utterance. Use read_agent_inbox for exact details; "
    + "use handle_agent_event to record each disposition or answer privately. Public text is real speech. Natural stopping does not acknowledge events.\n";
  const bodies = events.map((event) => JSON.stringify({ eventId: event.eventId, worker: event.subagentId,
    label: readSubagent(db, event.subagentId).label,
    workInputId: event.workInputId, kind: event.kind, digest: event.bodyDigest,
    sources: event.sourceContext.materials?.slice(0, 4).map((source) => ({ label: source.label?.slice(0, 100), reference: source.reference?.slice(0, 200) })),
    preview: utf8Preview(event.body ?? "", 1500), detailRequired: Buffer.byteLength(event.body ?? "", "utf8") > 1500 }));
  const rendered = header + bodies.join("\n");
  return rendered;
}

function utf8Preview(text: string, max: number): string {
  let result = ""; let bytes = 0;
  for (const point of text) { bytes += Buffer.byteLength(point, "utf8"); if (bytes > max) break; result += point; }
  return result;
}
export type SubagentInboxRepo = ReturnType<typeof createSubagentInboxRepo>;
