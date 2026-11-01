/**
 * INPUT:  one completed SDK request's usage and exact prepared envelope, plus committed-turn reserve policy
 * OUTPUT: bounded request capture and detached TurnUsageReport with matching provider usage/request measurement
 * POS:    core/agents — calibration reporting boundary; rejected/missing usage produces no fabricated sample
 */
import type { ModelMessage, Telemetry, ToolSet } from "ai";
import type { ReplayMeasurement } from "./conversation-store.ts";
import { estimatePreparedToolSchemaTokens, estimateToolSchemaTokens, measureRequest, type RequestMeasurement } from "./request-measurement.ts";

export interface TurnUsageReport {
  characterId?: string;
  /** One completed request's usage, not cumulative Run/turn accounting. */
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

type RequestUsageSample = Pick<TurnUsageContext, "instructions" | "outgoing" | "preparedTools" | "usage">;

/** Keep only the latest completed request; the turn owner still decides whether post-commit reporting is allowed. */
export function createTurnUsageCapture() {
  let pending: Omit<RequestUsageSample, "usage"> | undefined;
  let sample: RequestUsageSample | undefined;
  const telemetry: Telemetry = {
    onLanguageModelCallStart: (event) => {
      sample = undefined;
      // ChatAgent assembles string instructions. Do not pair an unsupported SDK instruction shape with a fallback.
      pending = typeof event.instructions === "string"
        ? { instructions: event.instructions, outgoing: event.messages, preparedTools: event.tools ?? [] } : undefined;
    },
    onStepEnd: (event) => {
      // SDK result.usage sums all steps; event.usage belongs to this prepared request, including its cache details.
      sample = pending && event.finishReason !== "error" ? { ...pending, usage: Promise.resolve(event.usage) } : undefined;
      pending = undefined;
    },
  };
  return { telemetry, latest: () => sample };
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
