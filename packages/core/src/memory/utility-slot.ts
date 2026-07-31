/**
 * INPUT:  the MAIN LanguageModel, an optional UtilityConfig, a Logger; background work handed to run()
 * OUTPUT: createUtilitySlot(deps) -> { model, run, usage } — the resolved background model, a GLOBAL serial task chain
 *         that never rejects outward, and cumulative token spend since boot
 * POS:    core/memory — T5-R11's utility slot: every background LLM pass (the episodic/flush writers today, the tidy
 *         pass next) runs through here, so which provider pays for background work is ONE operator choice
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { UtilityConfig } from "../config/utility-config.ts";
import type { Logger } from "../logging/logger.ts";

/** Cumulative background spend since boot; `usageUnknown` counts tasks whose token usage could not be read in full. */
export interface UtilityUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usageUnknown: number;
}

export interface UtilitySlot {
  /** The model every background pass takes: the utility provider when configured, else the main model. */
  readonly model: LanguageModel;
  /** Queue a background task. Resolves with its value, or `undefined` when it failed — it never rejects outward. */
  run<T>(label: string, task: () => Promise<T>): Promise<T | undefined>;
  /** Cumulative spend since boot, in memory (the media-usage reporting precedent). */
  usage(): UtilityUsage;
}

export interface UtilitySlotDeps {
  mainModel: LanguageModel;
  /** Absent/null = no separate slot configured. */
  config?: UtilityConfig | null;
  logger: Logger;
}

export function createUtilitySlot(deps: UtilitySlotDeps): UtilitySlot {
  const log = deps.logger.child({ mod: "utility-slot" });
  // Falling back to the MAIN model is the shipped default, not a degraded mode: Letta's sleep-time agent inherits the
  // primary's llm_config and "use a stronger model" is documentation guidance (rc §A2). A cheaper/stronger background
  // provider is the operator's choice to make, never a requirement for the feature to work.
  const model = deps.config ? utilityModel(deps.config) : deps.mainModel;
  const totals: UtilityUsage = { calls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0 };
  // ONE global chain (R11: background tasks run serially): a tidy pass and a flush write must not bid for the same
  // provider at once, whichever characters they belong to.
  let chain: Promise<unknown> = Promise.resolve();

  function run<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
    const next = chain.then(async (): Promise<T | undefined> => {
      totals.calls += 1;
      try {
        const value = await task();
        account(totals, value);
        return value;
      } catch (error) {
        // Background work is never load-bearing for a chat turn, so a failure is a warn + a skipped pass; the label
        // is what makes the line diagnosable (content never enters a log — logging-guidelines).
        totals.usageUnknown += 1;
        log.warn({ label, err: readable(error) }, "utility task failed");
        return undefined;
      }
    });
    chain = next; // next never rejects, so the chain can never wedge on a failed task
    return next;
  }

  return { model, run, usage: () => ({ ...totals }) };
}

function utilityModel(config: UtilityConfig): LanguageModel {
  return createOpenAICompatible({
    name: "taki-utility",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  }).languageModel(config.model);
}

/**
 * Read the token spend off whatever the task resolved with. Structural rather than a required reporting call (the
 * flush-writer's isOkResult precedent): a task can just `return agent.generate(...)` and its spend is accounted for,
 * with no second step to forget. AI SDK v7 types both totals as `number | undefined`, so a missing field counts 0
 * and marks the pass unaccounted rather than silently reading as free.
 */
function account(totals: UtilityUsage, value: unknown): void {
  const usage = reported(value);
  totals.inputTokens += usage?.input ?? 0;
  totals.outputTokens += usage?.output ?? 0;
  if (usage?.input === undefined || usage.output === undefined) totals.usageUnknown += 1;
}

function reported(value: unknown): { input: number | undefined; output: number | undefined } | undefined {
  if (typeof value !== "object" || value === null || !("usage" in value)) return undefined;
  const usage = (value as { usage: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const { inputTokens, outputTokens } = usage as { inputTokens?: unknown; outputTokens?: unknown };
  return { input: finite(inputTokens), output: finite(outputTokens) };
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
