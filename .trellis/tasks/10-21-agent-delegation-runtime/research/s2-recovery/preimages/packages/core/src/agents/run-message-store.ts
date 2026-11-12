/**
 * INPUT: exact linked Run/work scope, private repositories and trusted source/currentness callbacks
 * OUTPUT: selected private replay, SDK-step input receipts and faithful completed/partial work evidence
 * POS: core/agents — shared WorkContext implementation; never writes the relationship Timeline or Memory
 */
import type { ModelMessage, ToolSet, StopCondition } from "ai";
import type { PrivateMessage, SubagentInput, SubagentToolSelection, SubagentWorkScope, SubagentWorkToken } from "@taki/shared";
import type { SubagentRepo } from "../db/subagent-repo.ts";
import type { SubagentInputRepo } from "../db/subagent-input-repo.ts";
import type { SubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import type { RunMessageRepo } from "../db/run-message-repo.ts";
import type { ReplayProjection } from "./conversation-store.ts";
import type { PreparedWorkStep, WorkContext } from "./work-context.ts";
import { toEntryInput, toModelMessage, type TurnMessage } from "./turn-mapping.ts";
import { selectWindow } from "./context-window.ts";
import { estimateMessagesTokens } from "../memory/token-estimator.ts";
import { resolveDelegationTools } from "../harness/delegation-tools.ts";
import type { ToolMaterialSink } from "../harness/subagent-tool-materials.ts";
import { fenceUntrusted } from "./untrusted-fence.ts";

export interface RunMessageStoreInput {
  runId: string; scope: SubagentWorkScope; instructions: string; tools: ToolSet; stop?: StopCondition<ToolSet>;
  parentNames?: readonly string[]; selection?: SubagentToolSelection; historyBudget(): number;
  children: SubagentRepo; inputs: SubagentInputRepo; executions: SubagentExecutionRepo; messages: RunMessageRepo;
  materialSink: ToolMaterialSink;
  parentReplay?: () => ReplayProjection;
  checkCurrent(token: SubagentWorkToken | undefined, phase: "model_intent" | "result"): void;
  onCompletedStep?(input: { attemptId: string; stepNumber: number; messages: TurnMessage[] }): void;
  changed(): void;
}

export function createRunMessageStore(input: RunMessageStoreInput): WorkContext {
  let carried = new Set<string>();
  let attempt: string | undefined;
  const prepared = new Map<number, PreparedWorkStep>();
  return {
    scope: input.scope, instructions: input.instructions, tools: input.tools, stop: input.stop,
    selectTools: (tools) => resolveDelegationTools({ tools, parentNames: input.parentNames ?? Object.keys(tools),
      scope: input.scope, selection: input.selection }),
    project(attemptId) {
      attempt = attemptId; prepared.clear(); carried = new Set();
      if (input.scope.kind === "parent-continuation") {
        if (!input.parentReplay) throw new Error("SUBAGENT_PARENT_CONTEXT_REQUIRED");
        return input.parentReplay();
      }
      const projected = projectChild(input, input.scope.subagentId);
      carried = new Set(projected.inputIds);
      return projected.replay;
    },
    prepareStep(step) {
      if (attempt !== step.attemptId) throw new Error("SUBAGENT_ATTEMPT_CONTEXT_MISMATCH");
      const existing = prepared.get(step.stepNumber);
      if (existing) return { ...existing, messages: step.messages === existing.messages ? existing.messages
        : replacePreparedPrefix(existing, step.messages) };
      const selected = input.scope.kind === "subagent" ? workInputs(input, input.scope) : [];
      const added = selected.filter((record) => !carried.has(record.inputId));
      for (const record of added) carried.add(record.inputId);
      const token = input.scope.kind === "subagent" ? { ...input.executions.token(input.runId),
        throughWorkSeq: selected.at(-1)?.workSeq ?? input.executions.token(input.runId).throughWorkSeq } : undefined;
      const result: PreparedWorkStep = { ...step, messages: [...step.messages, ...added.map(renderSubagentInput)],
        token, inputIds: selected.filter((record) => carried.has(record.inputId)).map((record) => record.inputId) };
      prepared.set(step.stepNumber, result); return result;
    },
    commitModelInput(step, effect) {
      input.checkCurrent(step.token, "model_intent");
      if (effect.runId !== input.runId || effect.attemptId !== step.attemptId) throw new Error("SUBAGENT_MODEL_INTENT_MISMATCH");
      if (step.token) input.messages.recordModelInputs({ effect, token: step.token, stepNumber: step.stepNumber, inputIds: step.inputIds });
    },
    recordCompletedStep(step) {
      const messages = input.materialSink.attach(step.attemptId, step.messages.map(toEntryInput).filter((entry) => entry !== null));
      if (messages.length) input.messages.recordStep({ runId: input.runId, attemptId: step.attemptId,
        batch: { stepNumber: step.stepNumber, entryKind: "output", messages } });
      input.onCompletedStep?.(step); input.changed();
    },
    recordPartial(partial) {
      if (!partial.text) return;
      input.messages.stageTerminal({ runId: input.runId, attemptId: partial.attemptId,
        batch: { stepNumber: partial.stepNumber, entryKind: "partial", messages: [{ role: "assistant", content: partial.text }] } });
    },
  };
}

// The first SDK preparation may follow envelope reduction. Retain its message projection while the selected
// input IDs remain fixed; subsequent calls at this same step do not append the addressed batch a second time.
function replacePreparedPrefix(prepared: PreparedWorkStep, messages: ModelMessage[]): ModelMessage[] {
  return messages.length === prepared.messages.length ? messages : prepared.messages;
}

function workInputs(input: RunMessageStoreInput, scope: Extract<SubagentWorkScope, { kind: "subagent" }>): SubagentInput[] {
  const rows: SubagentInput[] = []; let afterSeq = 0;
  for (;;) {
    const page = input.inputs.list({ subagentId: scope.subagentId, workInputId: scope.workInputId, afterSeq, limit: 200 });
    rows.push(...page);
    if (page.length < 200) return rows;
    afterSeq = page.at(-1)!.inputSeq;
  }
}

function projectChild(input: RunMessageStoreInput, subagentId: string): { replay: ReplayProjection; inputIds: string[] } {
  const child = input.children.get(subagentId);
  const rows = input.messages.history({ subagentId, newest: true, replay: true, limit: 2000 });
  const source = rows.map((row) => row.inputId ? { ...row, ...renderInputEntry(input.inputs.get(row.inputId)) } : row);
  const selected = selectWindow(source, input.historyBudget());
  const initial = child.initialContext.kind === "snapshot" ? child.initialContext.messages.map(toModelMessage)
    .filter((message): message is ModelMessage => message !== null) : [];
  const messages = selected.entries.map(toModelMessage).filter((message): message is ModelMessage => message !== null);
  const omitted = rows.length === 2000 || selected.entries.length < rows.length;
  const notice: ModelMessage[] = omitted ? [{ role: "user", content: "Core context note: older private work is omitted from this request. Use inspect_subagent to read retained history; omitted work was not supplied here." }] : [];
  const all = [...initial, ...notice, ...messages];
  return { inputIds: selected.entries.flatMap((row) => row.inputId ? [row.inputId] : []), replay: { messages: all,
    windowStartSeq: selected.windowStartSeq, measurement: { sourceRows: rows.length, liveRows: rows.length,
      selectedRows: selected.entries.length, summaryTokens: 0, liveTokensBeforeFolds: estimateMessagesTokens(messages),
      foldedTokensSaved: 0, historyTokens: estimateMessagesTokens(all), tokenBoundaryHit: omitted, sourceBackstopHit: rows.length === 2000 } } };
}

export function renderSubagentInput(input: SubagentInput): ModelMessage {
  return { role: "user", content: renderInputEntry(input).content };
}

function renderInputEntry(input: SubagentInput): PrivateMessage {
  const sender = input.sender.kind === "user" ? "the user addressing this child" : input.sender.kind === "parent" ? "the delegating Companion" : "the trusted work owner";
  const material = input.materials.map((item) => fenceUntrusted({ source: "delegated-material", content: JSON.stringify(item) })).join("\n\n");
  return { role: "user", content: [`Core addressed work input from ${sender}. This is private work context, not a new main-conversation utterance.`,
    input.direction || "Continue this exact work under its original purpose.", material].filter(Boolean).join("\n\n") };
}
