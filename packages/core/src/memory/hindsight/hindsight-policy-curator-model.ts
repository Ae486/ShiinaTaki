/**
 * INPUT:  one admitted scoped report, proposal-only tools and the existing Utility Slot model
 * OUTPUT: a bounded production AI SDK tool loop with actual completed-step/token usage
 * POS:    core/memory/hindsight — caller owns the single slot.run and durable outcome handling
 */
import { ToolLoopAgent, hasToolCall, isStepCount, type LanguageModel, type ToolSet } from "ai";
import { HINDSIGHT_POLICY_FINISH_TOOL } from "./hindsight-policy-curator-prompt.ts";

export interface HindsightPolicyCuratorDriverInput {
  model: LanguageModel; system: string; prompt: string; tools: ToolSet;
  maxSteps: number; signal: AbortSignal;
  assertInput(): void;
  onStepEnd(): void;
}
export interface HindsightPolicyCuratorDriverResult {
  steps: number;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
}
export type HindsightPolicyCuratorDriver = (input: HindsightPolicyCuratorDriverInput) => Promise<HindsightPolicyCuratorDriverResult>;

export const runHindsightPolicyCuratorModel: HindsightPolicyCuratorDriver = async (input) => {
  const agent = new ToolLoopAgent({ model: input.model, instructions: input.system, tools: input.tools, maxRetries: 0,
    stopWhen: [hasToolCall(HINDSIGHT_POLICY_FINISH_TOOL), isStepCount(input.maxSteps)],
    prepareStep: () => { input.assertInput(); return {}; }, onStepEnd: () => input.onStepEnd() });
  input.assertInput();
  const result = await agent.generate({ prompt: input.prompt, abortSignal: input.signal });
  return { steps: result.steps.length, usage: { inputTokens: result.totalUsage.inputTokens, outputTokens: result.totalUsage.outputTokens } };
};
