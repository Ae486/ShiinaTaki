/**
 * INPUT: trusted linked work, selected replay and actual SDK step/Effect boundaries
 * OUTPUT: private execution context and durable input/output recording ports
 * POS: core/agents — shared ChatAgent integration, independent of initiative and primary history
 */
import type { ModelMessage, StopCondition, ToolSet } from "ai";
import type { EffectLifecycle, SubagentWorkScope, SubagentWorkToken } from "@taki/shared";
import type { ReplayProjection } from "./conversation-store.ts";
import type { TurnMessage } from "./turn-mapping.ts";

export interface PreparedWorkStep {
  messages: ModelMessage[];
  attemptId: string;
  stepNumber: number;
  inputIds: readonly string[];
  token?: SubagentWorkToken;
}

export interface WorkContext {
  readonly scope: SubagentWorkScope;
  readonly instructions: string;
  readonly tools: ToolSet;
  readonly stop?: StopCondition<ToolSet>;
  selectTools(tools: ToolSet): ToolSet;
  project(attemptId: string): ReplayProjection;
  prepareStep(input: { messages: ModelMessage[]; attemptId: string; stepNumber: number }): PreparedWorkStep;
  commitModelInput(step: PreparedWorkStep, effect: EffectLifecycle): void;
  recordCompletedStep(input: { attemptId: string; stepNumber: number; messages: TurnMessage[] }): void;
  recordPartial(input: { attemptId: string; stepNumber: number; text: string }): void;
}
