/**
 * INPUT:  the MAIN LanguageModel, an optional UtilityConfig, a Logger; background work handed to run()
 * OUTPUT: the resolved background model, a global serial task chain, real cumulative usage and stop/settle ownership
 * POS:    core/memory — T5-R11's utility slot: every background LLM pass (the episodic/flush writers today, the tidy
 *         pass next) runs through here, so which provider pays for background work is ONE operator choice
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AsyncLocalStorage } from "node:async_hooks";
import type { UtilityConfig } from "../config/utility-config.ts";
import type { Logger } from "../logging/logger.ts";
import type { AuxiliaryUsageMeter } from "../observability/auxiliary-usage-meter.ts";
import { withAuxiliaryUsageTask } from "../observability/model-usage-context.ts";

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
  available?(): boolean;
  /** Capture once at logical operation admission, retaining the same global queue and usage owner. */
  capture?(): UtilitySlot;
  /** Queue a background task. Resolves with its value, or `undefined` when it failed — it never rejects outward. */
  run<T>(label: string, task: () => Promise<T>): Promise<T | undefined>;
  /** Cumulative spend since boot, in memory (the media-usage reporting precedent). */
  usage(): UtilityUsage;
}

export interface UtilitySlotDeps {
  mainModel?: LanguageModel;
  resolveModel?: () => LanguageModel | undefined;
  /** Absent/null = no separate slot configured. */
  config?: UtilityConfig | null;
  logger: Logger;
  usageMeter?: AuxiliaryUsageMeter;
}

export function createUtilitySlot(deps: UtilitySlotDeps): UtilitySlot & { stop(): Promise<void>; settle(): Promise<void> } {
  const log = deps.logger.child({ mod: "utility-slot" });
  // Falling back to the MAIN model is the shipped default, not a degraded mode: Letta's sleep-time agent inherits the
  // primary's llm_config and "use a stronger model" is documentation guidance (rc §A2). A cheaper/stronger background
  // provider is the operator's choice to make, never a requirement for the feature to work.
  const fallback = deps.config ? utilityModel(deps.config) : deps.mainModel;
  const active = new AsyncLocalStorage<LanguageModel>();
  const resolve = () => deps.resolveModel ? deps.resolveModel() : fallback;
  const resolveWrapped = createModelResolver(resolve, deps.usageMeter);
  resolveWrapped();
  const captured = () => { const model = active.getStore() ?? resolveWrapped();
    if (!model) throw new Error("MODEL_UNAVAILABLE"); return model; };
  const totals: UtilityUsage = { calls: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0 };
  // ONE global chain (R11: background tasks run serially): a tidy pass and a flush write must not bid for the same
  // provider at once, whichever characters they belong to.
  let chain: Promise<unknown> = Promise.resolve();
  let stopped = false;

  function run<T>(label: string, task: () => Promise<T>, bound?: LanguageModel): Promise<T | undefined> {
    if (stopped) return Promise.resolve(undefined);
    const model = bound ?? active.getStore() ?? resolveWrapped();
    if (!model) return Promise.reject(new Error("MODEL_UNAVAILABLE"));
    const next = chain.then(async (): Promise<T | undefined> => {
      if (stopped) return undefined;
      totals.calls += 1;
      try {
        const value = await active.run(model, () => withAuxiliaryUsageTask(label, task));
        account(totals, value);
        return value;
      } catch {
        // Background work is never load-bearing for a chat turn, so a failure is a warn + a skipped pass; the label
        // is what makes the line diagnosable. Provider exceptions may contain prompts, payloads, or credentials, so
        // only the closed failure class crosses the logging boundary.
        totals.usageUnknown += 1;
        log.warn({ label, code: "UTILITY_TASK_FAILED" }, "utility task failed");
        return undefined;
      }
    });
    chain = next; // next never rejects, so the chain can never wedge on a failed task
    return next;
  }

  const settle = async () => {
    let current: Promise<unknown>;
    do { current = chain; await current; } while (current !== chain);
  };
  const usage = () => ({ ...totals });
  const capture = (): UtilitySlot => {
    const bound = captured();
    const slot: UtilitySlot = { get model() { return active.getStore() ?? bound; }, available: () => true,
      run: (label, task) => run(label, task, bound), usage, capture: () => slot };
    return slot;
  };
  return { get model() { return captured(); }, available: () => resolve() !== undefined, capture, run, usage, settle, stop: () => { stopped = true; return settle(); } };
}

/** Fixed injected test slots already have operation-local identity. */
export function captureUtilitySlot(slot: UtilitySlot): UtilitySlot { return slot.capture?.() ?? slot; }

function createModelResolver(resolve: () => LanguageModel | undefined, meter?: AuxiliaryUsageMeter) {
  let wrappedSource: LanguageModel | undefined;
  let wrappedModel: LanguageModel | undefined;
  return () => {
    const source = resolve();
    if (source !== wrappedSource) {
      wrappedSource = source;
      wrappedModel = source ? meter?.wrapModel(source, { source: "utility", label: "utility" }) ?? source : undefined;
    }
    return wrappedModel;
  };
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
