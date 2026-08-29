/**
 * INPUT:  exact model request messages/instructions/tools, replay measurement, and a configured envelope reserve
 * OUTPUT: provider-neutral request cost decomposition; provider usage remains an external calibration anchor
 * POS:    core/agents — request measurement shared by usage calibration and future pressure observability
 */
import { asSchema, type ModelMessage, type Tool, type ToolSet } from "ai";
import { estimateMessagesTokens, estimateTokens } from "../memory/token-estimator.ts";
import type { ReplayMeasurement } from "./conversation-store.ts";

export interface RequestMeasurement extends ReplayMeasurement {
  requestMessageTokens: number;
  instructionTokens: number;
  toolSchemaTokens: number;
  responseReserveTokens: number;
  estimatedInputTokens: number;
  projectedRequestTokens: number;
  accountingQuality: "provider" | "calibrated" | "estimated" | "unknown";
}

export interface RequestMeasurementInput {
  replay: ReplayMeasurement;
  messages: ModelMessage[];
  instructions: string;
  toolSchemaTokens: number;
  envelopeReserveTokens: number;
}

export function measureRequest(input: RequestMeasurementInput): RequestMeasurement {
  const toolSchemaTokens = finiteNonNegative(input.toolSchemaTokens, "toolSchemaTokens");
  const envelopeReserveTokens = finiteNonNegative(input.envelopeReserveTokens, "envelopeReserveTokens");
  const requestMessageTokens = estimateMessagesTokens(input.messages);
  const instructionTokens = estimateTokens(input.instructions);
  const estimatedInputTokens = requestMessageTokens + instructionTokens + toolSchemaTokens;
  const requestTailTokens = Math.max(0, requestMessageTokens - input.replay.historyTokens);
  const responseReserveTokens = Math.max(
    0,
    envelopeReserveTokens - requestTailTokens - instructionTokens - toolSchemaTokens,
  );
  return {
    ...input.replay,
    requestMessageTokens,
    instructionTokens,
    toolSchemaTokens,
    responseReserveTokens,
    estimatedInputTokens,
    projectedRequestTokens: estimatedInputTokens + responseReserveTokens,
    accountingQuality: "estimated",
  };
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`request measurement ${label} is not finite`);
  return Math.max(0, value);
}

/** Mirrors AI SDK v7's checked-in provider-tool preparation fields without serializing execute closures. */
export async function estimateToolSchemaTokens(tools: ToolSet, toolOrder: string[]): Promise<number> {
  if (Object.keys(tools).length === 0) return 0;
  const definitions = await Promise.all(orderedTools(tools, toolOrder).map(([name, value]) => toolDefinition(name, value)));
  return estimateTokens(JSON.stringify(definitions));
}

/** Prices the SDK's already-prepared provider definitions, preserving dynamic descriptions and exact ordering. */
export function estimatePreparedToolSchemaTokens(definitions: ReadonlyArray<Record<string, unknown>>): number {
  return estimateTokens(JSON.stringify(definitions));
}

function orderedTools(tools: ToolSet, toolOrder: string[]): Array<[string, Tool]> {
  const rank = new Map(toolOrder.map((name, index) => [name, index]));
  return Object.entries(tools).sort(([left], [right]) => {
    const leftRank = rank.get(left);
    const rightRank = rank.get(right);
    if (leftRank !== undefined || rightRank !== undefined)
      return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

async function toolDefinition(name: string, tool: Tool): Promise<unknown> {
  if (tool.type === "provider") return { type: "provider", name, id: tool.id, args: tool.args };
  const description = typeof tool.description === "function"
    ? tool.description({ context: undefined as never })
    : tool.description;
  return {
    type: "function",
    name,
    inputSchema: await asSchema(tool.inputSchema).jsonSchema,
    ...(description === undefined ? {} : { description }),
    ...(tool.inputExamples === undefined ? {} : { inputExamples: tool.inputExamples }),
    ...(tool.providerOptions === undefined ? {} : { providerOptions: tool.providerOptions }),
    ...(tool.strict === undefined ? {} : { strict: tool.strict }),
  };
}
