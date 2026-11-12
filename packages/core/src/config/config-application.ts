/**
 * INPUT: sparse configuration source, registered consumer boundaries and application outcomes
 * OUTPUT: read-only desired/applied observations with revision-fenced change notification
 * POS: core/config — observes existing consumers; owns neither their resources nor another work queue
 */
import type { ConfigApplication } from "@taki/shared";
import type { ConfigSource } from "./config-source.ts";
import { CONFIG_KNOBS, findKnob } from "./knob-registry.ts";

type Boundary = ConfigApplication["boundary"];
type State = ConfigApplication["state"];
interface Observation { revision: number; value: ConfigApplication }

const BOUNDARIES: Record<string, Boundary> = {
  TAKI_DATA_DIR: "bootstrap", TAKI_WS_HOST: "component", TAKI_WS_PORT: "component",
  TAKI_LOG_LEVEL: "immediate", TAKI_PROMPT_DIR: "next-run", TAKI_TRUST_LOOPBACK_OPERATOR: "immediate",
  TAKI_PROVIDER_BASE_URL: "next-run", TAKI_PROVIDER_API_KEY: "next-run", TAKI_PROVIDER_MODEL: "next-run",
  TAKI_PROVIDER_CONTEXT_TOKENS: "next-run", TAKI_PROVIDER_INCLUDE_USAGE: "next-run",
  TAKI_CONTEXT_HISTORY_RATIO: "next-run", TAKI_MAX_STEPS: "next-run",
  TAKI_UTILITY_BASE_URL: "next-operation", TAKI_UTILITY_API_KEY: "next-operation", TAKI_UTILITY_MODEL: "next-operation",
  TAKI_UTILITY_CONTEXT_TOKENS: "next-operation", TAKI_COMPACT_TRIGGER_RATIO: "next-operation",
  TAKI_COMPACT_KEEP_MESSAGES: "next-operation", TAKI_ATTACHMENT_TTL_DAYS: "immediate",
  TAKI_AMBIENT_SCREENSHOT: "immediate", TAKI_AMBIENT_SCREENSHOT_RETENTION: "component",
  TAKI_MEMORY_PINNED_BUDGET: "next-run", TAKI_MEMORY_BM25_WEIGHTS: "component", TAKI_MEMORY_STOPLIST: "maintenance",
  TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS: "next-operation", TAKI_MEMORY_TIDY_WRITE_THRESHOLD: "next-operation",
  TAKI_MEMORY_TIDY_MAX_STEPS: "next-operation", TAKI_MEMORY_TIDY_STALE_DAYS: "next-operation",
  TAKI_MEMORY_TIDY_REPORT_CAP: "next-operation", TAKI_MEMORY_TIDY_BATCH_TIMEOUT_MS: "next-operation",
  TAKI_MEMORY_TIDY_INPUT_TOKENS: "next-operation",
  TAKI_HINDSIGHT_ENABLED: "component", TAKI_HINDSIGHT_ENDPOINT: "component",
  TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS: "next-operation", TAKI_HINDSIGHT_SETUP_TIMEOUT_MS: "next-operation",
  TAKI_HINDSIGHT_POLICY_TIMEOUT_MS: "next-operation", TAKI_HINDSIGHT_POLICY_PROMPT: "next-operation",
  TAKI_HINDSIGHT_DEPLOYMENT_MODE: "external", TAKI_HINDSIGHT_TEMPLATE_REVISION: "external",
  TAKI_HINDSIGHT_MODEL_DEFAULT_PROVIDER: "external", TAKI_HINDSIGHT_MODEL_DEFAULT: "external",
  TAKI_HINDSIGHT_MODEL_RETAIN: "external", TAKI_HINDSIGHT_MODEL_REFLECT: "external",
  TAKI_HINDSIGHT_MODEL_CONSOLIDATION: "external", TAKI_HINDSIGHT_EMBEDDING_PROVIDER: "external",
  TAKI_HINDSIGHT_EMBEDDING_MODEL: "external", TAKI_HINDSIGHT_RERANKER_PROVIDER: "external",
  TAKI_HINDSIGHT_RERANKER_MODEL: "external",
};

export function configApplicationBoundary(key: string): Boundary {
  if (BOUNDARIES[key]) return BOUNDARIES[key];
  if (findKnob(key)?.apply === "live") return "immediate";
  throw new Error(`Missing configuration consumer boundary: ${key}`);
}

export function createConfigApplication(input: { source: ConfigSource; changed(key: string): void }) {
  const observations = new Map<string, Observation>();
  const desired = (key: string) => findKnob(key)?.secret ? null : input.source.resolve(key)?.value ?? null;
  const notify = (key: string) => { try { input.changed(key); } catch { /* Notification cannot roll back a consumer. */ } };
  for (const knob of CONFIG_KNOBS) {
    const boundary = configApplicationBoundary(knob.key);
    // Old restart labels stay honest until the real consumer registers its current observation.
    const state: State = boundary === "external" ? "external" : knob.apply === "restart" || boundary === "bootstrap"
      ? "restart-required" : "applied";
    observations.set(knob.key, { revision: 0, value: { boundary, state, activeValue: desired(knob.key) } });
  }
  const read = (key: string): ConfigApplication | undefined => {
    const value = observations.get(key)?.value;
    return value ? { ...value } : undefined;
  };
  const mark = (keys: readonly string[], state: State, details?: string | Pick<ConfigApplication, "activeValue" | "message">) => {
    for (const key of keys) {
      const previous = observations.get(key);
      if (!previous) continue;
      observations.set(key, { revision: previous.revision + 1, value: { ...previous.value, state,
        message: typeof details === "string" ? details : details?.message,
        activeValue: typeof details === "object" ? details.activeValue : state === "applied" ? desired(key) : previous.value.activeValue } });
      notify(key);
    }
  };
  const apply = (keys: readonly string[], operation: () => void | Promise<void>): void | Promise<void> => {
    const captures = keys.flatMap((key) => {
      const previous = observations.get(key);
      if (!previous) return [];
      const revision = previous.revision + 1;
      observations.set(key, { revision, value: { ...previous.value, state: "applying" } });
      notify(key);
      return [{ key, revision, activeValue: desired(key) }];
    });
    const settle = (state: "applied" | "failed") => {
      for (const capture of captures) {
        const current = observations.get(capture.key);
        if (current?.revision !== capture.revision) continue;
        current.value = { ...current.value, state, activeValue: state === "applied" ? capture.activeValue : current.value.activeValue,
          message: state === "failed" ? applicationFailureMessage(current.value.activeValue) : undefined };
        notify(capture.key);
      }
    };
    try {
      const result = operation();
      if (result instanceof Promise) return result.then(() => settle("applied"), () => settle("failed"));
      settle("applied");
    } catch { settle("failed"); }
  };
  return { read, mark, apply };
}
export type ConfigApplicationTracker = ReturnType<typeof createConfigApplication>;

function applicationFailureMessage(active: ConfigApplication["activeValue"]): string {
  return active === null ? "Saved; application failed." : "Saved; application failed. The previous usable setting is retained.";
}
