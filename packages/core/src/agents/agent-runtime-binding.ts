/**
 * INPUT: the locally prepared Main model and its immutable admission policy
 * OUTPUT: process-local resources shared by every Attempt of one Run
 * POS: core/agents — not serialized; model credentials remain inside the provider handle
 */
import type { LanguageModel } from "ai";
import type { ContextWindowSnapshot } from "@taki/shared";
import type { TurnUsageReport } from "./turn-usage-report.ts";
import type { RequestPreparationDeps } from "./request-preparation.ts";

export interface AgentRuntimeBinding {
  readonly model: LanguageModel;
  readonly modelId: string;
  readonly provider: string;
  readonly revision: number;
  readonly maxSteps: number;
  readonly historyBudget: () => number;
  readonly contextWindowTokens: () => number;
  readonly requestWindowSnapshot: () => ContextWindowSnapshot;
  readonly requestEnvelopeReserve: () => number;
  readonly onUsage: (report: TurnUsageReport) => void;
  readonly onOverflow: (observedInput: number) => void;
  readonly requestReduction: RequestPreparationDeps["requestReduction"];
}
