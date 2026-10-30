/**
 * INPUT: private conversation cursors and canonical ordered source references
 * OUTPUT: complete pageable sender-aware rows without duplicated input receipts or accepted reports
 * POS: core/db — read projection only; immutable input/message/event owners retain the full evidence
 */
import { SubagentConversationEntrySchema, type SubagentConversationEntry, type TimelineItemReference } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import { createRunMessageRepo } from "./run-message-repo.ts";
import { readSubagentInput } from "./subagent-readers.ts";
import { readSubagentEvent } from "./subagent-event-repo.ts";
import { digestRunValue } from "./run-row-mappers.ts";

export interface ConversationPageInput {
  subagentId: string; workInputId?: string; cursor?: { subagentId: string; seq: number };
  direction: "newest" | "older" | "newer"; limit: number;
}

export function readSubagentConversation(db: Database, input: ConversationPageInput) {
  if (input.cursor && input.cursor.subagentId !== input.subagentId) throw new Error("SUBAGENT_CURSOR_MISMATCH");
  if (input.direction !== "newest" && !input.cursor) throw new Error("SUBAGENT_CURSOR_REQUIRED");
  if (input.workInputId && readSubagentInput(db, input.workInputId).subagentId !== input.subagentId) throw new Error("SUBAGENT_WORK_MISMATCH");
  const ascending = input.direction === "newer";
  const entries: SubagentConversationEntry[] = [];
  let frontier = input.cursor?.seq ?? Number.MAX_SAFE_INTEGER;
  while (entries.length <= input.limit) {
    const rows = db.prepare(`SELECT * FROM subagent_conversation_order WHERE subagent_id=:child
      AND (:work IS NULL OR work_input_id=:work) AND seq ${ascending ? ">" : "<"} :frontier
      ORDER BY seq ${ascending ? "ASC" : "DESC"} LIMIT 200`)
      .all({ child: input.subagentId, work: input.workInputId ?? null, frontier });
    if (!rows.length) break;
    for (const row of rows) {
      frontier = Number(row.seq);
      const entry = projectEntry(db, row);
      if (entry) entries.push(previewEntry(entry));
      if (entries.length > input.limit) break;
    }
    if (rows.length < 200) break;
  }
  const hasMore = entries.length > input.limit;
  const page = entries.slice(0, input.limit);
  const nextCursor = hasMore && page.length ? { subagentId: input.subagentId, seq: page.at(-1)!.seq } : null;
  return { entries: ascending ? page : page.reverse(), nextCursor, hasMore };
}

function projectEntry(db: Database, row: SqlRow, decorate = true): SubagentConversationEntry | undefined {
  const base = { seq: row.seq, subagentId: row.subagent_id, workInputId: row.work_input_id,
    historicalOrder: row.historical_order === 1, createdAt: row.created_at };
  const id = String(row.source_id);
  if (row.source_kind === "input") return SubagentConversationEntrySchema.parse({ ...base, kind: "input", input: readSubagentInput(db, id) });
  if (row.source_kind === "event") {
    const event = readSubagentEvent(db, id);
    const step = event.producerKey === "terminal" ? db.prepare(`SELECT max(step_number) AS step FROM run_messages
      WHERE run_id=:run AND attempt_id=:attempt AND entry_kind='output'`).get({ run: event.producerRunId, attempt: event.producerAttemptId })?.step
      : Number(event.producerKey.split(":")[1]);
    if (typeof step === "number" && presentationPending(db, { runId: event.producerRunId,
      attemptId: event.producerAttemptId, stepNumber: step })) return;
    return SubagentConversationEntrySchema.parse({ ...base, kind: "event", event, ...(decorate && typeof step === "number"
      ? batchMetadata(db, { runId: event.producerRunId, attemptId: event.producerAttemptId, stepNumber: step, event }) : {}) });
  }
  if (row.source_kind === "control") {
    const control = db.prepare("SELECT * FROM subagent_controls WHERE control_id=:id").get({ id });
    if (!control) throw new Error("SUBAGENT_HISTORY_SOURCE_UNAVAILABLE");
    return SubagentConversationEntrySchema.parse({ ...base, kind: "control", control: {
      origin: control.origin, action: control.action, controlVersion: control.control_version } });
  }
  const source = db.prepare("SELECT run_id FROM run_messages WHERE seq=:id").get({ id: Number(id) });
  if (!source) throw new Error("SUBAGENT_HISTORY_SOURCE_UNAVAILABLE");
  const message = createRunMessageRepo(db).list({ runId: String(source.run_id), afterSeq: Number(id) - 1, limit: 1 })[0];
  if (!message || message.seq !== Number(id)) throw new Error("SUBAGENT_HISTORY_SOURCE_UNAVAILABLE");
  if (message.entryKind === "output" && presentationPending(db, message)) return;
  if (message.entryKind === "partial" && db.prepare(`SELECT 1 FROM run_messages
    WHERE run_id=:run AND attempt_id=:attempt AND step_number=:step AND entry_kind='output' LIMIT 1`)
    .get({ run: message.runId, attempt: message.attemptId, step: message.stepNumber })) return;
  const parts = message.parts?.filter((part) => {
    if (part.type !== "tool-call" && part.type !== "tool-result") return true;
    if (!["complete_subagent", "interact_parent"].includes(part.toolName)) return true;
    return !db.prepare(`SELECT 1 FROM subagent_events WHERE producer_run_id=:run AND producer_attempt_id=:attempt
      AND (producer_key=:key OR (:name='complete_subagent' AND kind='final')) LIMIT 1`)
      .get({ run: message.runId, attempt: message.attemptId, key: `interaction:${message.stepNumber}:${part.toolCallId}`, name: part.toolName });
  });
  if ((message.parts?.length && !parts?.length) || (!message.content && !parts?.length)) return;
  const presentation = db.prepare("SELECT references_json FROM subagent_message_presentation WHERE message_seq=:seq").get({ seq: message.seq });
  const references = presentation ? JSON.parse(String(presentation.references_json)) as TimelineItemReference[] : [];
  const retained = references.flatMap((ref) => {
    if (!("partIndex" in ref) || ref.partIndex === undefined) return [ref];
    const original = message.parts?.[ref.partIndex];
    const partIndex = original ? parts?.indexOf(original) ?? -1 : -1;
    return partIndex < 0 ? [] : [{ ...ref, partIndex }];
  });
  return SubagentConversationEntrySchema.parse({ ...base, kind: "message", message: { ...message, parts },
    ...(decorate ? { ...batchMetadata(db, message), presentation: { messageId: message.runId, references: retained } } : {}) });
}

function presentationPending(db: Database, input: { runId: string; attemptId: string; stepNumber: number }): boolean {
  // onStepEnd can commit canonical rows before the public stream has supplied their stable item references.
  // Keep that transient gap in the live projection; raw history remains authoritative and independently readable.
  return Boolean(db.prepare(`SELECT 1 FROM run_messages m JOIN runs r ON r.run_id=m.run_id
    WHERE m.run_id=:run AND m.attempt_id=:attempt AND m.step_number=:step AND m.entry_kind='output'
    AND r.state IN ('running','waiting','cancel_requested')
    AND NOT EXISTS(SELECT 1 FROM subagent_message_presentation p WHERE p.message_seq=m.seq) LIMIT 1`)
    .get({ run: input.runId, attempt: input.attemptId, step: input.stepNumber }));
}

function batchMetadata(db: Database, input: { runId: string; attemptId: string; stepNumber: number; event?: ReturnType<typeof readSubagentEvent> }) {
  const rows = db.prepare(`SELECT o.* FROM subagent_conversation_order o JOIN run_messages m ON o.source_id=CAST(m.seq AS TEXT)
    WHERE o.source_kind='message' AND m.run_id=:run AND m.attempt_id=:attempt AND m.step_number=:step AND m.entry_kind='output'
    UNION ALL SELECT o.* FROM subagent_conversation_order o JOIN subagent_events e ON o.source_id=e.event_id
    WHERE o.source_kind='event' AND e.producer_run_id=:run AND e.producer_attempt_id=:attempt
    AND (e.producer_key LIKE :prefix OR (e.producer_key='terminal' AND :step=(SELECT max(step_number) FROM run_messages
      WHERE run_id=:run AND attempt_id=:attempt AND entry_kind='output'))) ORDER BY seq`)
    .all({ run: input.runId, attempt: input.attemptId, step: input.stepNumber, prefix: `interaction:${input.stepNumber}:%` });
  const entrySeqs = rows.filter((row) => projectEntry(db, row, false)).map((row) => Number(row.seq));
  const result = { batch: { runId: input.runId, attemptId: input.attemptId, stepNumber: input.stepNumber, entrySeqs } };
  if (!input.event) return result;
  const messages = db.prepare(`SELECT seq FROM run_messages WHERE run_id=:run AND attempt_id=:attempt AND step_number=:step ORDER BY seq`)
    .all({ run: input.runId, attempt: input.attemptId, step: input.stepNumber }).flatMap((row) =>
      createRunMessageRepo(db).list({ runId: input.runId, afterSeq: Number(row.seq) - 1, limit: 1 }));
  for (const message of messages) {
    const stored = db.prepare("SELECT references_json FROM subagent_message_presentation WHERE message_seq=:seq").get({ seq: message.seq });
    if (!stored) continue;
    const references = (JSON.parse(String(stored.references_json)) as TimelineItemReference[]).filter((ref) => {
      const part = ref.kind === "tool" ? message.parts?.[ref.partIndex] : undefined;
      return part && (part.type === "tool-call" || part.type === "tool-result") && (input.event?.producerKey === "terminal"
        ? part.toolName === "complete_subagent" : input.event?.producerKey === `interaction:${input.stepNumber}:${part.toolCallId}`);
    });
    if (references.length) return { ...result, presentation: { messageId: input.runId, references } };
  }
  return result;
}

function previewEntry(entry: SubagentConversationEntry): SubagentConversationEntry {
  const serialized = JSON.stringify(entry);
  if (Buffer.byteLength(serialized, "utf8") <= 12_000) return entry;
  const body = { digest: digestRunValue(entry), totalChars: serialized.length, nextOffset: 0 as const };
  if (entry.kind === "input") return { ...entry, body, input: { ...entry.input, direction: entry.input.direction.slice(0, 1000),
    materials: [], replyAcceptance: null, toolSelection: null } };
  if (entry.kind === "event") return { ...entry, body, event: { ...entry.event,
    body: entry.event.body?.slice(0, 1000) ?? null, sourceContext: { materials: [] } } };
  if (entry.kind === "message") return { ...entry, body, presentation: undefined,
    message: { ...entry.message, content: entry.message.content.slice(0, 1000), parts: undefined, sourceContext: undefined } };
  return entry;
}

export function readSubagentConversationBody(db: Database, input: { subagentId: string; seq: number; offset: number; limit: number; digest?: string }) {
  const row = db.prepare("SELECT * FROM subagent_conversation_order WHERE subagent_id=:child AND seq=:seq")
    .get({ child: input.subagentId, seq: input.seq });
  const entry = row && projectEntry(db, row);
  if (!entry) throw new Error("SUBAGENT_HISTORY_SOURCE_UNAVAILABLE");
  const digest = digestRunValue(entry);
  if (input.digest && input.digest !== digest) throw new Error("SUBAGENT_HISTORY_BODY_CHANGED");
  const text = JSON.stringify(entry);
  if (input.offset > text.length || input.offset < 0) throw new Error("SUBAGENT_CURSOR_MISMATCH");
  const end = Math.min(text.length, input.offset + Math.max(1, Math.min(12_000, input.limit)));
  return { seq: input.seq, digest, body: text.slice(input.offset, end), offset: input.offset,
    nextOffset: end < text.length ? end : null, complete: end === text.length };
}
