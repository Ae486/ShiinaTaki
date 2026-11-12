/**
 * INPUT: committed model profiles, scalar config source and model-scoped calibration storage
 * OUTPUT: cached current policy and immutable Run captures with matched usage/replay callbacks
 * POS: core/config — only config changes prepare policy; request admission performs no full config scan
 */
import { createHash } from "node:crypto";
import { createWindowCalibrator, type WindowCalibrator } from "../agents/window-calibrator.ts";
import { reduceMessages } from "../agents/context-reduction.ts";
import { reductionTargetTokens } from "../agents/request-preparation.ts";
import type { AgentRuntimeBinding } from "../agents/agent-runtime-binding.ts";
import type { WindowStateRepo } from "../db/window-state-repo.ts";
import type { ConfigSource } from "./config-source.ts";
import type { ModelProfileService } from "./model-profile-service.ts";
import { loadContextConfig } from "./context-config.ts";
import { loadAgentConfig } from "./agent-config.ts";
import { appException } from "../server/app-error.ts";

export function createAgentRuntimeConfig(input: { models: ModelProfileService; source: ConfigSource; windows: WindowStateRepo }) {
  let calibration: { key: string; window: WindowCalibrator } | undefined;
  let current: AgentRuntimeBinding | undefined;
  let invalidPolicy = false;
  const prepare = () => {
    const binding = input.models.binding("main");
    if (!binding) { current = undefined; return; }
    const env = input.source.env();
    const config = loadContextConfig({ ...env, TAKI_UTILITY_CONTEXT_TOKENS: undefined, TAKI_COMPACT_KEEP_MESSAGES: undefined });
    const agent = loadAgentConfig(env);
    const key = createHash("sha256").update(JSON.stringify([binding.baseUrl, binding.modelId, binding.revision, config.contextTokens.main])).digest("hex");
    // Retired Runs retain their own closure; the current owner must not retain every historical profile.
    if (calibration?.key !== key) calibration = { key,
      window: createWindowCalibrator({ repo: input.windows, slot: `main:${key}`, declared: config.contextTokens.main }) };
    const window = calibration.window;
    const historyBudget = () => Math.floor(window.effectiveWindow() * config.historyRatio);
    const captured: AgentRuntimeBinding = {
      ...binding, maxSteps: agent.maxSteps, historyBudget,
      contextWindowTokens: window.effectiveWindow, requestWindowSnapshot: window.snapshot,
      requestEnvelopeReserve: () => Math.max(0, window.effectiveWindow() - historyBudget()),
      onUsage: (report) => window.onUsage(report.inputTokens ?? 0, report.estimatedInput),
      onOverflow: (observedInput) => { window.onOverflow(observedInput); },
      requestReduction: ({ outgoing, measurement }) => {
        const threshold = window.effectiveWindow() * config.compact.triggerRatio;
        if (measurement.projectedInputTokens < threshold) return undefined;
        const reduced = reduceMessages({ messages: outgoing,
          targetTokens: reductionTargetTokens({ thresholdTokens: threshold, projectedInputTokens: measurement.projectedInputTokens,
            requestMessageTokens: measurement.requestMessageTokens }), recentMessages: 4, summaryHead: measurement.summaryTokens > 0 });
        return reduced.tokensSaved > 0 ? reduced.messages : undefined;
      },
    };
    current = Object.freeze(captured);
  };
  const refresh = () => {
    try { prepare(); invalidPolicy = false; }
    catch { invalidPolicy = true; }
  };
  refresh();
  return { refresh, available: () => current !== undefined, issue: () => invalidPolicy ? "MODEL_POLICY_INVALID" : undefined,
    capture: () => {
      if (invalidPolicy && !current) throw appException("CONFIG_REFUSED", "模型运行设置无效，请在设置中修正。", { reason: "MODEL_POLICY_INVALID", slot: "main" });
      return current;
    } };
}
