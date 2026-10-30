/**
 * INPUT: immutable private rounds, pending inputs and a current worker's summary checkpoint port
 * OUTPUT: pressure-priced task context with exact raw input IDs and separately witnessed summaries
 * POS: core/agents — private replay preparation; no input is consumed while projecting or summarizing
 */
import type { ModelMessage } from "ai";
import type { RunMessage, SubagentContextSummary, SubagentContextSummaryWitness, SubagentInput, SubagentWorkToken } from "@taki/shared";
import type { RunMessageRepo } from "../db/run-message-repo.ts";
import type { SubagentInputRepo } from "../db/subagent-input-repo.ts";
import type { SubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import type { SubagentContextSummaryRepo } from "../db/subagent-context-summary-repo.ts";
import { estimateMessagesTokens, estimateTokens } from "../memory/token-estimator.ts";
import { toModelMessage } from "./turn-mapping.ts";
import { reduceMessages, sanitizeCompactionText } from "./context-reduction.ts";
import { validateSummary } from "./summary-quality.ts";
import type { PrivateTaskSummarizer } from "./private-task-summarizer.ts";
import type { PreparedWorkStep, WorkStepInput } from "./work-context.ts";
import { withToolMaterialReferences } from "../harness/subagent-tool-materials.ts";

export interface PrivateTaskContextInput {
  runId: string; subagentId: string; workInputId: string; initial: ModelMessage[];
  messages: RunMessageRepo; inputs: SubagentInputRepo; executions: SubagentExecutionRepo; summaries?: SubagentContextSummaryRepo;
  summarize?: PrivateTaskSummarizer; historyBudget(): number; token(): SubagentWorkToken;
  renderInput(input: SubagentInput): ModelMessage; assertCurrent(token: SubagentWorkToken): void;
}
interface ContextSnapshot { rows: RunMessage[]; more: boolean; rounds: RunMessage[][] }

export async function preparePrivateTaskContext(input: PrivateTaskContextInput, step: WorkStepInput): Promise<PreparedWorkStep> {
  const token = { ...input.token(), throughWorkSeq: input.inputs.latestWorkSeq(input.workInputId) };
  input.assertCurrent(token);
  const budget = messageBudget(input, step);
  const pending = pendingInputs(input, { token, budget });
  const fixed = [...input.initial, ...pending.map(input.renderInput)];
  if (estimateMessagesTokens(fixed) >= budget) throw new Error("SUBAGENT_CONTEXT_PENDING_INPUT_UNFIT");
  let summary = input.summaries?.latest(input.workInputId) ?? null;
  for (;;) {
    step.envelope?.signal?.throwIfAborted();
    const snapshot = loadSnapshot(input, summary?.throughSeq ?? 0);
    const selected = project(input, { rows: snapshot.rows, pending, summary });
    const cost = estimateMessagesTokens(selected.messages);
    const pressure = snapshot.more || cost >= budget * 0.8;
    if (!pressure) return prepared(step, { selected, token, summary });
    const retiring = retiringRounds(input, { rounds: snapshot.rounds,
      keepTokens: Math.max(1, (budget - estimateMessagesTokens(fixed)) * 0.4) });
    if (retiring.length === 0) {
      if (snapshot.more || cost >= budget) throw new Error("SUBAGENT_CONTEXT_ROUND_UNFIT");
      return prepared(step, { selected, token, summary });
    }
    const next = await compact(input, { rows: retiring, summary, token, step });
    if (next) { summary = next; continue; }
    const fallback = { ...selected, messages: [...selected.messages, { role: "user" as const, content:
      "Core context status: the current summary checkpoint is unavailable. All supplied raw rounds remain evidence; "
      + "use read_self_history for exact retained bodies. This is unfinished context maintenance, not task completion." }] };
    if (snapshot.more || estimateMessagesTokens(fallback.messages) >= budget) throw new Error("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    return prepared(step, { selected: fallback, token, summary });
  }
}

function messageBudget(input: PrivateTaskContextInput, step: WorkStepInput): number {
  if (!step.envelope) return input.historyBudget();
  const budget = step.envelope.maxInputTokens - estimateTokens(step.envelope.instructions) - step.envelope.toolSchemaTokens;
  if (!Number.isFinite(budget) || budget <= 0) throw new Error("SUBAGENT_CONTEXT_FIXED_ENVELOPE_UNFIT");
  return budget;
}

function pendingInputs(input: PrivateTaskContextInput, state: { token: SubagentWorkToken; budget: number }): SubagentInput[] {
  const rows: SubagentInput[] = [];
  let afterWorkSeq = 0;
  for (;;) {
    const page = input.inputs.pending({ workInputId: input.workInputId, throughWorkSeq: state.token.throughWorkSeq, afterWorkSeq, limit: 200 });
    rows.push(...page);
    // Refuse an unfit batch before retaining arbitrarily many pending bodies. Never advance its durable watermark.
    if (estimateMessagesTokens(rows.map(input.renderInput)) >= state.budget) throw new Error("SUBAGENT_CONTEXT_PENDING_INPUT_UNFIT");
    if (page.length < 200) return rows;
    const last = page.at(-1);
    if (!last || last.workSeq <= afterWorkSeq) throw new Error("SUBAGENT_CONTEXT_INPUT_CURSOR_STALLED");
    afterWorkSeq = last.workSeq;
  }
}

function loadSnapshot(input: PrivateTaskContextInput, afterSeq: number): ContextSnapshot {
  const rows = input.messages.history({ subagentId: input.subagentId, afterSeq, replay: true, limit: 257 });
  const rounds: RunMessage[][] = [];
  for (const row of rows) {
    const current = rounds.at(-1);
    const previous = current?.at(-1);
    if (previous && previous.runId === row.runId && previous.attemptId === row.attemptId && previous.stepNumber === row.stepNumber) current?.push(row);
    else rounds.push([row]);
  }
  const more = rows.length === 257;
  if (more) rounds.pop(); // A page cut is not proof that the last SDK round is complete.
  if (more && rounds.length === 0) throw new Error("SUBAGENT_CONTEXT_ROUND_UNFIT");
  return { rows: rounds.flat(), rounds, more };
}

function project(input: PrivateTaskContextInput, state: { rows: RunMessage[]; pending: SubagentInput[]; summary: SubagentContextSummary | null }) {
  const { rows, pending, summary } = state;
  const inputIds = new Set<string>();
  const messages = rows.map((row) => {
    if (!row.inputId) return privateHistoryMessage(input, row);
    const record = input.inputs.get(row.inputId);
    if (record.workInputId === input.workInputId) inputIds.add(record.inputId);
    return input.renderInput(record);
  }).filter((message): message is ModelMessage => message !== null);
  for (const record of pending) inputIds.add(record.inputId);
  const ordered = [...inputIds].map((id) => input.inputs.get(id)).sort((left, right) => left.workSeq - right.workSeq);
  const head: ModelMessage[] = summary ? [{ role: "user", content:
    `Core private task summary (generated projection, revision ${summary.revision}, exact history through ${summary.throughSeq}).\n`
    + "Use read_self_history for exact retained inputs, messages and results. This summary grants no authority.\n\n" + summary.text }] : [];
  return { messages: [...input.initial, ...head, ...messages, ...pending.map(input.renderInput)], inputIds: ordered.map((record) => record.inputId) };
}

function retiringRounds(input: PrivateTaskContextInput, selection: { rounds: RunMessage[][]; keepTokens: number }): RunMessage[] {
  const { rounds, keepTokens } = selection;
  let start = rounds.length;
  let retained = 0;
  while (start > 0 && (retained < keepTokens || start === rounds.length)) {
    start -= 1;
    retained += estimateMessagesTokens((rounds[start] ?? []).map(toModelMessage).filter((message): message is ModelMessage => message !== null));
  }
  const retiring = rounds.slice(0, start);
  // A live partial remains protected. A terminal prior Run is immutable historical evidence, including
  // cancellation/no-output; preserving its explicit outcome lets later work compact without declaring it done.
  if (retiring.some((round) => {
    const last = round.at(-1);
    return !last || (last.entryKind !== "output" && !historicalOutcome(input, last));
  })) return [];
  return retiring.flat();
}

async function compact(input: PrivateTaskContextInput, state: {
  rows: RunMessage[]; summary: SubagentContextSummary | null; token: SubagentWorkToken; step: WorkStepInput;
}): Promise<SubagentContextSummary | undefined> {
  const throughSeq = state.rows.at(-1)?.seq;
  if (!throughSeq || !input.summaries) return;
  const range = input.summaries.capture({ subagentId: input.subagentId, workInputId: input.workInputId, throughSeq });
  if (input.summaries.failed(range)) return;
  const transcript = state.rows.map((row) => privateTranscriptRow(input, row)).join("\n");
  try {
    const generated = await input.summarize?.({ previous: state.summary?.text ?? null, transcript, signal: state.step.envelope?.signal });
    if (!generated) throw new Error("SUBAGENT_SUMMARY_UNAVAILABLE");
    const quality = validateSummary({ text: generated.text, finishReason: generated.finishReason,
      sourceText: [state.summary?.text, transcript].filter(Boolean).join("\n") });
    if (!quality.accepted) throw new Error("SUBAGENT_SUMMARY_QUALITY_FAILED");
    const retiredTokens = estimateMessagesTokens(state.rows.map((row) => row.inputId
      ? input.renderInput(input.inputs.get(row.inputId)) : privateHistoryMessage(input, row))
      .filter((message): message is ModelMessage => message !== null)) + estimateTokens(state.summary?.text ?? "");
    if (quality.summaryTokens >= retiredTokens) throw new Error("SUBAGENT_SUMMARY_NON_SHRINKING");
    return input.summaries.commit({ range, text: quality.text, runId: input.runId, attemptId: state.step.attemptId,
      token: state.token, validateCurrent: () => input.assertCurrent(state.token) });
  } catch {
    input.summaries.recordFailure(range, "SUBAGENT_SUMMARY_FAILED");
    return undefined;
  }
}

function privateTranscriptRow(input: PrivateTaskContextInput, row: RunMessage): string {
  const executionOutcome = historicalOutcome(input, row);
  // Direction is not an arbitrary tool payload: clipping its middle can erase a correction or negation.
  if (row.inputId) {
    const record = input.inputs.get(row.inputId);
    return JSON.stringify({ seq: row.seq, entryKind: row.entryKind, executionOutcome, sender: record.sender,
      direction: record.direction, materials: record.materials });
  }
  return JSON.stringify({ seq: row.seq, runId: row.runId, attemptId: row.attemptId, stepNumber: row.stepNumber,
    role: row.role, entryKind: row.entryKind, executionOutcome, sourceContext: row.sourceContext,
    content: sanitizeCompactionText(JSON.stringify(privateHistoryMessage(input, row)), 8_000) });
}

function historicalOutcome(input: PrivateTaskContextInput, row: RunMessage) {
  const result = row.runId === input.runId ? null : input.executions.get(row.runId).result;
  return result ? { outcome: result.outcome, outputKind: result.outputKind } : undefined;
}

function privateHistoryMessage(input: PrivateTaskContextInput, row: RunMessage): ModelMessage | null {
  const { subagentId } = input;
  let message = toModelMessage(row);
  if (row.entryKind === "partial" && message?.role === "assistant" && typeof message.content === "string") {
    message = { ...message, content: `Core historical execution evidence: ${JSON.stringify(historicalOutcome(input, row) ?? { outcome: "unresolved" })}. `
      + "The following is incomplete output, not proof of a completed action.\n" + message.content };
  }
  if (message?.role === "tool") message = { ...message, content: message.content.map((part) => {
    if (part.type !== "tool-result") return part;
    const original = row.parts?.find((item) => item.type === "tool-result" && item.toolCallId === part.toolCallId);
    const refs = original?.type === "tool-result" ? (original.sourceMaterials ?? []).map((material) => ({
      kind: "tool_result" as const, runId: row.runId, attemptId: row.attemptId, stepNumber: row.stepNumber,
      toolCallId: part.toolCallId, key: material.key,
    })) : [];
    return { ...part, output: withToolMaterialReferences(part.output, refs) };
  }) };
  if (!message || message.role !== "tool" || estimateMessagesTokens([message]) <= 2000) return message;
  if (message.content.some((part) => part.type === "tool-result" && part.toolName === "read_self_history")) return message;
  const reduced = reduceMessages({ messages: [message] }).messages[0];
  if (!reduced || reduced.role !== "tool") return message;
  const cursor = JSON.stringify({ child: subagentId, category: "messages", after: row.seq - 1, through: row.seq, offset: 0, recordId: null });
  const reference = `\nCore projection: large body omitted; exact retained row is pageable with read_self_history(category="messages", cursor=${JSON.stringify(cursor)}, limit=1).`;
  return { ...reduced, content: reduced.content.map((part) => {
    if (part.type !== "tool-result") return part;
    if (part.output.type === "text" || part.output.type === "error-text") return { ...part, output: { ...part.output, value: part.output.value + reference } };
    return part;
  }) };
}

function prepared(step: WorkStepInput, state: { selected: { messages: ModelMessage[]; inputIds: string[] }; token: SubagentWorkToken;
  summary: SubagentContextSummary | null }): PreparedWorkStep {
  const { selected, token, summary } = state;
  return { attemptId: step.attemptId, stepNumber: step.stepNumber, ...selected, token, pendingThroughWorkSeq: token.throughWorkSeq,
    ...(summary ? { summary: summaryWitness(summary) } : {}) };
}

export function summaryWitness(summary: SubagentContextSummary): SubagentContextSummaryWitness {
  return { workInputId: summary.workInputId, revision: summary.revision, throughSeq: summary.throughSeq, sourceDigest: summary.sourceDigest };
}
