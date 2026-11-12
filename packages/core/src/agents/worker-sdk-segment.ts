/**
 * INPUT: completed native SDK step, actual retained bytes, and private durable checkpoint ports
 * OUTPUT: safe pressure rollover decisions and complete-envelope work preparation budgets
 * POS: core/agents — same-Attempt SDK segmentation only; never executes, retries or settles a Run
 */
import type { ModelMessage, StepResult, ToolSet } from "ai";
import type { ChatAgentDeps } from "./chat-agent.ts";
import type { WorkContext, WorkContextEnvelope } from "./work-context.ts";
import { estimateToolSchemaTokens } from "./request-measurement.ts";
import { estimateTokens } from "../memory/token-estimator.ts";

export async function workerEnvelope(input: {
  deps: ChatAgentDeps; work: WorkContext; instructions: string; tools: ToolSet;
  activeTools: readonly string[]; signal?: AbortSignal;
}): Promise<WorkContextEnvelope> {
  const visible = Object.fromEntries(input.activeTools.map((name) => [name, input.tools[name]!]));
  const toolSchemaTokens = await estimateToolSchemaTokens(visible, [...input.activeTools]);
  const reserve = input.deps.requestEnvelopeReserve?.() ?? 0;
  const responseReserve = Math.max(0, reserve - estimateTokens(input.instructions) - toolSchemaTokens);
  return {
    instructions: input.instructions,
    toolSchemaTokens,
    maxInputTokens: (input.deps.contextWindowTokens?.() ?? (input.work.inputBudget?.() ?? 8000) + reserve) - responseReserve,
    signal: input.signal,
  };
}

export function completedWorkerFrontier(step: Pick<StepResult<ToolSet>, "finishReason" | "toolCalls" | "content">): boolean {
  if (step.finishReason !== "tool-calls" || step.toolCalls.length === 0) return false;
  if (step.content.some((part) => part.type === "tool-approval-request")) return false;
  // Local execution and argument-validation errors are settled native outcomes. Runtime separately fences
  // unknown Effects; an invalid call can authorize continuation only through its matching completed error.
  const outcomes = step.content.filter((part) => part.type === "tool-result" || part.type === "tool-error");
  return step.toolCalls.every((call) => !call.providerExecuted
    && outcomes.some((result) => result.toolCallId === call.toolCallId && result.toolName === call.toolName
      && !result.providerExecuted && !("preliminary" in result && result.preliminary)
      && (!call.invalid || result.type === "tool-error")))
    && outcomes.length === step.toolCalls.length;
}

export function retainedWorkerBytes(input: { messages: ModelMessage[]; results: unknown; prepared: ModelMessage[] }): number {
  // Price the actual raw result as well as its smaller toModelOutput projection and request copy.
  return Buffer.byteLength(JSON.stringify(input));
}
