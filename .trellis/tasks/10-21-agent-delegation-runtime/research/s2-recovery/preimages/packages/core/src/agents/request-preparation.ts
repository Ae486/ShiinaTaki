/**
 * INPUT:  the admitted model instructions/messages/tools plus optional reduction and measurement hooks
 * OUTPUT: one measured outgoing request projection, with deterministic reduction applied before the provider call
 * POS:    core/agents — request-admission preparation seam; projection-only and detached from Timeline persistence
 */
import type { ModelMessage, ToolSet } from "ai";
import type { ConversationStore, ReplayMeasurement } from "./conversation-store.ts";
import { estimateToolSchemaTokens, measureRequest, type RequestMeasurement } from "./request-measurement.ts";

export interface RequestReductionInput {
  characterId: string;
  instructions: string;
  outgoing: ModelMessage[];
  replay: ReplayMeasurement;
  measurement: RequestMeasurement;
}

export interface RequestPreparationDeps {
  requestEnvelopeReserve?: () => number;
  onRequestMeasured?: (characterId: string, measurement: RequestMeasurement) => void;
  requestReduction?: (input: RequestReductionInput) => ModelMessage[] | undefined;
}

export interface RequestPreparationInput {
  characterId: string;
  instructions: string;
  outgoing: ModelMessage[];
  replay: ReplayMeasurement;
  tools: ToolSet;
  toolOrder: string[];
}

export function reductionTargetTokens(input: {
  thresholdTokens: number;
  projectedInputTokens: number;
  requestMessageTokens: number;
}): number {
  const nonMessageTokens = Math.max(0, input.projectedInputTokens - input.requestMessageTokens);
  // Equality still qualifies for compaction. Aim at the largest integer message budget strictly below the trigger.
  return Math.max(0, Math.ceil(input.thresholdTokens - nonMessageTokens) - 1);
}

export interface PreparedRequest {
  messages: ModelMessage[];
  measurement: RequestMeasurement;
  toolSchemaTokens: number;
}

export function measurePreparedRequest(
  deps: RequestPreparationDeps,
  input: RequestPreparationInput & { toolSchemaTokens: number },
): PreparedRequest {
  const meterInput = {
    replay: input.replay,
    messages: input.outgoing,
    instructions: input.instructions,
    toolSchemaTokens: input.toolSchemaTokens,
    envelopeReserveTokens: deps.requestEnvelopeReserve?.() ?? 0,
  };
  const measurement = measureRequest(meterInput);
  deps.onRequestMeasured?.(input.characterId, measurement);
  const reduced = deps.requestReduction?.({
    characterId: input.characterId,
    instructions: input.instructions,
    outgoing: input.outgoing,
    replay: input.replay,
    measurement,
  });
  if (reduced === undefined) return { messages: input.outgoing, measurement, toolSchemaTokens: input.toolSchemaTokens };
  const reducedMeasurementBase = measureRequest({ ...meterInput, messages: reduced });
  const reductionTokensSaved = Math.max(0, measurement.estimatedInputTokens - reducedMeasurementBase.estimatedInputTokens);
  const reducedMeasurement = { ...reducedMeasurementBase, reductionTokensSaved };
  deps.onRequestMeasured?.(input.characterId, reducedMeasurement);
  return { messages: reduced, measurement: reducedMeasurement, toolSchemaTokens: input.toolSchemaTokens };
}

export async function prepareOutgoingRequest(
  deps: RequestPreparationDeps,
  input: RequestPreparationInput,
): Promise<PreparedRequest> {
  const toolSchemaTokens = await estimateToolSchemaTokens(input.tools, input.toolOrder);
  return measurePreparedRequest(deps, { ...input, toolSchemaTokens });
}

export function measurePostTurnRequest(
  deps: RequestPreparationDeps,
  input: {
    characterId: string;
    instructions: string;
    tools: ToolSet;
    toolOrder: string[];
    toolSchemaTokens: number;
    store: ConversationStore;
  },
): void {
  const replay = input.store.project(input.characterId);
  measurePreparedRequest(deps, {
    characterId: input.characterId,
    instructions: input.instructions,
    outgoing: replay.messages,
    replay: replay.measurement,
    tools: input.tools,
    toolOrder: input.toolOrder,
    toolSchemaTokens: input.toolSchemaTokens,
  });
}
