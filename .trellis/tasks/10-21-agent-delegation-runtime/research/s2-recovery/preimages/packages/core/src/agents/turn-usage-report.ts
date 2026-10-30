/**
 * INPUT:  committed-turn provider usage plus the exact request projection/instructions/tools and reserve policy
 * OUTPUT: detached TurnUsageReport with provider usage and provider-neutral request/context decomposition
 * POS:    core/agents — calibration reporting boundary; rejected/missing usage produces no fabricated sample
 */
import type { ModelMessage, ToolSet } from "ai";
import type { ReplayMeasurement } from "./conversation-store.ts";
import { estimatePreparedToolSchemaTokens, estimateToolSchemaTokens, measureRequest, type RequestMeasurement } from "./request-measurement.ts";

export interface TurnUsageReport {
  characterId?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Provider-calibration denominator; excludes response reserve because provider input usage excludes output. */
  estimatedInput: number;
  measurement: RequestMeasurement;
}

export interface TurnUsageDeps {
  onUsage?: (report: TurnUsageReport) => void;
  requestEnvelopeReserve?: () => number;
  /** Opt in to using provider input usage as the complete-envelope pressure anchor. */
  useProviderUsage?: boolean;
}

export interface TurnUsageContext {
  characterId?: string;
  usage: PromiseLike<{
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    inputTokenDetails?: { cacheReadTokens?: number };
  }>;
  instructions: string;
  outgoing: ModelMessage[];
  tools: ToolSet;
  toolOrder: string[];
  /** Exact SDK-prepared definitions captured at the model-call seam; absent only for compatibility callers. */
  preparedTools?: ReadonlyArray<Record<string, unknown>>;
  replay: ReplayMeasurement;
}

export function fireUsageReport(deps: TurnUsageDeps, ctx: TurnUsageContext): void {
  const report = deps.onUsage;
  if (!report) return;
  const preparedTools = ctx.preparedTools;
  const schemaTokens = preparedTools === undefined
    ? estimateToolSchemaTokens(ctx.tools, ctx.toolOrder)
    : Promise.resolve().then(() => estimatePreparedToolSchemaTokens(preparedTools));
  void Promise.all([Promise.resolve(ctx.usage), schemaTokens]).then(
    ([usage, toolSchemaTokens]) => {
      const measurement = measureRequest({ replay: ctx.replay, messages: ctx.outgoing, instructions: ctx.instructions,
        toolSchemaTokens, envelopeReserveTokens: deps.requestEnvelopeReserve?.() ?? 0,
        providerInputTokens: deps.useProviderUsage ? usage.inputTokens : undefined,
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens });
      // Usage is an optional detached observer. A callback failure must never become an unhandled rejection or alter
      // the already-committed chat result, just as a schema-estimation failure produces no calibration sample.
      return Promise.resolve().then(() => report({ characterId: ctx.characterId, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        estimatedInput: measurement.estimatedInputTokens, measurement }));
    },
    () => undefined,
  ).catch(() => undefined);
}
