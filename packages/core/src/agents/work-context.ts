/**
 * INPUT: trusted linked work, selected replay and actual SDK step/Effect boundaries
 * OUTPUT: private execution context and durable input/output recording ports
 * POS: core/agents — shared ChatAgent integration, independent of initiative and primary history
 */
import type { ModelMessage, StopCondition, ToolSet } from "ai";
import type { EffectLifecycle, SubagentWorkScope, SubagentWorkToken, SubagentContextSummaryWitness } from "@taki/shared";
import type { ReplayProjection } from "./conversation-store.ts";
import type { TurnMessage } from "./turn-mapping.ts";

export interface PreparedWorkStep {
  messages: ModelMessage[];
  attemptId: string;
  stepNumber: number;
  inputIds: readonly string[];
  pendingThroughWorkSeq?: number;
  summary?: SubagentContextSummaryWitness;
  token?: SubagentWorkToken;
}

export interface WorkContextEnvelope {
  instructions: string;
  toolSchemaTokens: number;
  maxInputTokens: number;
  signal?: AbortSignal;
}
export interface WorkStepInput {
  messages: ModelMessage[];
  attemptId: string;
  stepNumber: number;
  envelope?: WorkContextEnvelope;
}
export type WorkSegmentCheckpoint = { kind: "continue" } | {
  kind: "context_rollover"; messages: ModelMessage[]; summary?: SubagentContextSummaryWitness;
};

export interface WorkContext {
  readonly scope: SubagentWorkScope;
  readonly instructions: string;
  readonly tools: ToolSet;
  readonly stop?: StopCondition<ToolSet>;
  inputBudget?(): number;
  selectTools(tools: ToolSet): ToolSet;
  project(attemptId: string): ReplayProjection;
  prepareStep(input: WorkStepInput): PreparedWorkStep | Promise<PreparedWorkStep>;
  checkpointSegment?(input: { attemptId: string; stepNumber: number; retainedBytes: number;
    safeToRollover: boolean; envelope?: WorkContextEnvelope }): Promise<WorkSegmentCheckpoint>;
  commitModelInput(step: PreparedWorkStep, effect: EffectLifecycle): void;
  recordCompletedStep(input: { attemptId: string; stepNumber: number; messages: TurnMessage[] }): void;
  recordPartial(input: { attemptId: string; stepNumber: number; text: string }): void;
}
