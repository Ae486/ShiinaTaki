/**
 * INPUT: visible completed steps, observed partial output and exact model Effect input batches
 * OUTPUT: private ordered native messages, immutable first receipts and staged terminal tails
 * POS: core/db — Run transcript owner; never writes Timeline or semantic Memory
 */
import { PrivateMessageSchema, RunMessageBatchSchema, RunMessageSchema, SubagentWorkTokenSchema,
  type EffectLifecycle, type PrivateMessage, type RunMessage, type RunMessageBatch, type SubagentWorkToken } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import { digestRunValue } from "./run-row-mappers.ts";
import { readRunById } from "./run-readers.ts";
import { readSubagent, readSubagentExecution, readSubagentInput } from "./subagent-readers.ts";

export function createRunMessageRepo(db: Database) {
  return {
    history: (input: ChildHistoryQuery) => listChildHistory(db, input),
    recordStep(input: { runId: string; attemptId: string; batch: RunMessageBatch }) {
      const batch = prepareRunMessageBatch(input.batch);
      db.transaction(() => {
        assertActive(db, input, true);
        appendRunMessageBatch(db, { ...input, batch });
      });
    },
    stageTerminal: (input: { runId: string; attemptId: string; batch: RunMessageBatch }) => stageTerminalMessages(db, input),
    /** Called inside EffectRepo.prepareIntent; its deferred FK joins the actual Effect insertion. */
    recordModelInputs(input: { effect: EffectLifecycle; token: SubagentWorkToken; stepNumber: number; inputIds: readonly string[] }) {
      const token = SubagentWorkTokenSchema.parse(input.token);
      const effect = input.effect;
      if (effect.kind !== "model" || !effect.inputDigest || effect.state !== "intent_committed") throw new Error("SUBAGENT_MODEL_INTENT_REQUIRED");
      db.transaction(() => {
        if (db.prepare("SELECT effect_id FROM run_effects WHERE effect_id=:id").get({ id: effect.effectId })) {
          throw new Error("SUBAGENT_MODEL_INTENT_ALREADY_COMMITTED");
        }
        assertActive(db, effect);
        validateInputToken(db, { ...input, token });
        const records = input.inputIds.map((id) => readSubagentInput(db, id));
        if (new Set(input.inputIds).size !== input.inputIds.length || records.some((record, index) => record.workInputId !== token.workInputId
          || record.workSeq > token.throughWorkSeq || (index > 0 && record.workSeq <= (records[index - 1]?.workSeq ?? 0)))) {
          throw new Error("SUBAGENT_INPUT_BATCH_MISMATCH");
        }
        const pending = db.prepare(`SELECT input_id FROM subagent_inputs WHERE work_input_id=:work
          AND work_seq<=:through AND consumed_run_id IS NULL`).all({ work: token.workInputId, through: token.throughWorkSeq });
        if (pending.some((record) => !input.inputIds.includes(String(record.input_id)))) throw new Error("SUBAGENT_INPUT_BATCH_INCOMPLETE");
        for (const [index, record] of records.entries()) appendInputReceipt(db, { record, effect, step: input.stepNumber, index });
        db.prepare("UPDATE subagent_executions SET through_work_seq=:through,work_token_json=:token WHERE run_id=:id")
          .run({ id: effect.runId, through: token.throughWorkSeq, token: JSON.stringify(token) });
      });
    },
    list(input: { runId: string; afterSeq?: number; limit?: number; replay?: boolean }): RunMessage[] {
      const replay = input.replay ? `AND (entry_kind<>'input' OR seq=(SELECT min(first.seq) FROM run_messages first
        WHERE first.run_id=m.run_id AND first.input_id=m.input_id))
        AND (entry_kind<>'partial' OR NOT EXISTS (SELECT 1 FROM run_messages completed
          WHERE completed.run_id=m.run_id AND completed.attempt_id=m.attempt_id AND completed.step_number=m.step_number AND completed.entry_kind='output'))` : "";
      return db.prepare(`SELECT * FROM run_messages m WHERE run_id=:run AND seq>:after ${replay} ORDER BY seq LIMIT :limit`)
        .all({ run: input.runId, after: input.afterSeq ?? 0, limit: Math.max(1, Math.min(input.limit ?? 50, 2000)) }).map(mapMessage);
    },
  };
}

function validateInputToken(db: Database, input: { effect: EffectLifecycle; token: SubagentWorkToken }): void {
  const child = readSubagent(db, input.token.subagentId);
  const execution = readSubagentExecution(db, input.effect.runId);
  const captured = SubagentWorkTokenSchema.parse(JSON.parse(String(execution.work_token_json)));
  if (child.activeRunId !== input.effect.runId || child.stopOrigin || child.controlVersion !== input.token.controlVersion
    || execution.work_input_id !== input.token.workInputId || input.token.throughWorkSeq < Number(execution.through_work_seq)
    || digestRunValue(captured.source ?? null) !== digestRunValue(input.token.source ?? null)) throw new Error("SUBAGENT_WORK_TOKEN_CONFLICT");
  const watermark = db.prepare("SELECT input_id FROM subagent_inputs WHERE work_input_id=:work AND work_seq=:seq")
    .get({ work: input.token.workInputId, seq: input.token.throughWorkSeq });
  if (!watermark) throw new Error("SUBAGENT_WORK_TOKEN_CONFLICT");
}

function appendInputReceipt(db: Database, input: { record: ReturnType<typeof readSubagentInput>; effect: EffectLifecycle; step: number; index: number }): void {
  const { record, effect } = input;
  const message = PrivateMessageSchema.parse({ role: "user", content: record.direction,
    sourceContext: { materials: record.materials.flatMap((material) => material.source ? [material.source] : []) } });
  const digest = digestRunValue({ message, materials: record.materials });
  const previous = db.prepare("SELECT * FROM run_messages WHERE model_effect_id=:effect AND input_id=:input")
    .get({ effect: effect.effectId, input: record.inputId });
  if (previous) {
    if (previous.batch_digest !== digest || previous.step_number !== input.step || previous.message_index !== input.index
      || previous.model_input_digest !== effect.inputDigest || previous.attempt_id !== effect.attemptId) throw new Error("RUN_MESSAGE_BATCH_CONFLICT");
    return;
  }
  insertMessage(db, { runId: effect.runId, attemptId: effect.attemptId, stepNumber: input.step, messageIndex: input.index,
    entryKind: "input", message, digest, inputId: record.inputId, effectId: effect.effectId, inputDigest: effect.inputDigest });
  if (!record.consumed) db.prepare(`UPDATE subagent_inputs SET consumed_run_id=:run,consumed_attempt_id=:attempt,
    consumed_step=:step,consumed_effect_id=:effect WHERE input_id=:id AND consumed_run_id IS NULL`)
    .run({ id: record.inputId, run: effect.runId, attempt: effect.attemptId, step: input.step, effect: effect.effectId });
}

export function appendRunMessageBatch(db: Database, input: { runId: string; attemptId: string; batch: RunMessageBatch }): void {
  const batch = prepareRunMessageBatch(input.batch);
  const digest = digestRunValue(batch);
  const rows = db.prepare(`SELECT batch_digest FROM run_messages
    WHERE run_id=:run AND attempt_id=:attempt AND step_number=:step AND entry_kind=:kind ORDER BY message_index`)
    .all({ run: input.runId, attempt: input.attemptId, step: batch.stepNumber, kind: batch.entryKind });
  if (rows.length) {
    if (rows.length !== batch.messages.length || rows.some((row) => row.batch_digest !== digest)) throw new Error("RUN_MESSAGE_BATCH_CONFLICT");
    return;
  }
  for (const [index, message] of batch.messages.entries()) insertMessage(db, { ...input, stepNumber: batch.stepNumber,
    entryKind: batch.entryKind, messageIndex: index, message, digest });
}

export function prepareRunMessageBatch(candidate: RunMessageBatch): RunMessageBatch {
  const batch = RunMessageBatchSchema.parse(candidate);
  const calls = new Map<string, string>();
  const seenCalls = new Set<string>();
  for (const message of batch.messages) {
    if (batch.entryKind === "partial" && (message.role !== "assistant" || message.parts)) throw new Error("RUN_MESSAGE_INVALID_PARTIAL");
    message.parts = message.parts?.map((part) => {
      if (part.type === "tool-call") {
        if (message.role !== "assistant" || seenCalls.has(part.toolCallId)) throw new Error("RUN_MESSAGE_INVALID_TOOL_GROUP");
        seenCalls.add(part.toolCallId);
        calls.set(part.toolCallId, part.toolName);
        const safe = { ...part };
        delete safe.input;
        return safe;
      }
      if (part.type === "tool-result") {
        if (message.role !== "tool" || calls.get(part.toolCallId) !== part.toolName) throw new Error("RUN_MESSAGE_INVALID_TOOL_GROUP");
        calls.delete(part.toolCallId);
      }
      return part;
    });
  }
  if (calls.size > 0) throw new Error("RUN_MESSAGE_INVALID_TOOL_GROUP");
  return batch;
}

function insertMessage(db: Database, input: { runId: string; attemptId: string; stepNumber: number; messageIndex: number;
  entryKind: "input" | "output" | "partial"; message: PrivateMessage; digest: string; inputId?: string; effectId?: string; inputDigest?: string }): void {
  db.prepare(`INSERT INTO run_messages (run_id,attempt_id,step_number,message_index,entry_kind,role,content,
    parts_json,source_context_json,input_id,model_effect_id,model_input_digest,batch_digest,created_at)
    VALUES (:run,:attempt,:step,:index,:kind,:role,:content,:parts,:source,:input,:effect,:inputDigest,:digest,:at)`)
    .run({ run: input.runId, attempt: input.attemptId, step: input.stepNumber, index: input.messageIndex, kind: input.entryKind,
      role: input.message.role, content: input.message.content, parts: input.message.parts ? JSON.stringify(input.message.parts) : null,
      source: input.message.sourceContext ? JSON.stringify(input.message.sourceContext) : null, input: input.inputId ?? null,
      effect: input.effectId ?? null, inputDigest: input.inputDigest ?? null, digest: input.digest, at: new Date().toISOString() });
}

function assertActive(db: Database, input: { runId: string; attemptId: string }, allowCancellation = false): void {
  const run = readRunById(db, input.runId);
  if (run.activeAttemptId !== input.attemptId || (run.state !== "running" && !(allowCancellation && run.state === "cancel_requested"))) {
    throw new Error("RUN_MESSAGE_STALE_ATTEMPT");
  }
  if (!db.prepare("SELECT run_id FROM subagent_executions WHERE run_id=:id OR parent_run_id=:id").get({ id: input.runId })) {
    throw new Error("SUBAGENT_EXECUTION_NOT_FOUND");
  }
}

function mapMessage(row: SqlRow): RunMessage {
  return RunMessageSchema.parse({ seq: row.seq, runId: row.run_id, attemptId: row.attempt_id, stepNumber: row.step_number,
    messageIndex: row.message_index, entryKind: row.entry_kind, role: row.role, content: row.content,
    parts: row.parts_json === null ? undefined : JSON.parse(String(row.parts_json)),
    sourceContext: row.source_context_json === null ? undefined : JSON.parse(String(row.source_context_json)),
    inputId: row.input_id, modelEffectId: row.model_effect_id, modelInputDigest: row.model_input_digest, createdAt: row.created_at });
}
export type RunMessageRepo = ReturnType<typeof createRunMessageRepo>;

interface ChildHistoryQuery { subagentId: string; workInputId?: string; afterSeq?: number; limit?: number; replay?: boolean }

function listChildHistory(db: Database, input: ChildHistoryQuery): RunMessage[] {
  const replay = input.replay ? `AND (m.entry_kind<>'input' OR m.seq=(SELECT min(first.seq) FROM run_messages first WHERE first.input_id=m.input_id))
    AND (m.entry_kind<>'partial' OR NOT EXISTS (SELECT 1 FROM run_messages completed
      WHERE completed.run_id=m.run_id AND completed.attempt_id=m.attempt_id AND completed.step_number=m.step_number AND completed.entry_kind='output'))` : "";
  return db.prepare(`SELECT m.* FROM run_messages m JOIN subagent_executions e ON e.run_id=m.run_id
    WHERE e.subagent_id=:child AND (:work IS NULL OR e.work_input_id=:work) AND m.seq>:after ${replay} ORDER BY m.seq LIMIT :limit`)
    .all({ child: input.subagentId, work: input.workInputId ?? null, after: input.afterSeq ?? 0,
      limit: Math.max(1, Math.min(input.limit ?? 50, 2000)) }).map(mapMessage);
}

function stageTerminalMessages(db: Database, input: { runId: string; attemptId: string; batch: RunMessageBatch }): void {
  const batch = prepareRunMessageBatch(input.batch);
  db.transaction(() => {
    assertActive(db, input, true);
    const row = db.prepare("SELECT * FROM subagent_executions WHERE run_id=:id OR parent_run_id=:id").get({ id: input.runId });
    if (!row) throw new Error("SUBAGENT_EXECUTION_NOT_FOUND");
    const prefix = row.run_id === input.runId ? "" : "parent_";
    const json = JSON.stringify(batch);
    const previous = row[`${prefix}terminal_messages_json`];
    if (previous !== null && (previous !== json || row[`${prefix}terminal_messages_attempt_id`] !== input.attemptId)) {
      throw new Error("RUN_MESSAGE_BATCH_CONFLICT");
    }
    db.prepare(`UPDATE subagent_executions SET ${prefix}terminal_messages_json=:json,
      ${prefix}terminal_messages_attempt_id=:attempt WHERE run_id=:id`)
      .run({ id: String(row.run_id), json, attempt: input.attemptId });
  });
}
