import { describe, expect, it } from "vitest";
import { ConfigEntrySchema } from "@taki/shared";
import { CONFIG_KNOBS, findKnob } from "./knob-registry.ts";

// The scoping research's env-knob table (rs-panel-scoping.md §7), expanded: its VLM and UTILITY rows each name
// three variables. TAKI_DEV_TRIGGER is deliberately absent (dev-only, not a panel knob), as are the two test
// fixtures the same grep found.
const EXPECTED_KEYS = [
  "TAKI_WS_HOST",
  "TAKI_WS_PORT",
  "TAKI_LOG_LEVEL",
  "TAKI_DATA_DIR",
  "TAKI_PROMPT_DIR",
  "TAKI_TRUST_LOOPBACK_OPERATOR",
  "TAKI_MONITOR_MODE",
  "TAKI_RECONNECT_BASE_MS",
  "TAKI_RECONNECT_CAP_MS",
  "TAKI_RECONNECT_STABILITY_RESET_MS",
  "TAKI_WS_OPEN_AUTH_TIMEOUT_MS",
  "TAKI_RPC_INTERACTIVE_TIMEOUT_MS",
  "TAKI_RPC_LONG_TIMEOUT_MS",
  "TAKI_CHAT_ACK_TIMEOUT_MS",
  "TAKI_PET_COSTUME_TOTAL_TIMEOUT_MS",
  "TAKI_RENDERER_LOAD_TIMEOUT_MS",
  "TAKI_HOME_RESULT_TIMEOUT_MS",
  "TAKI_PROVIDER_BASE_URL",
  "TAKI_PROVIDER_API_KEY",
  "TAKI_PROVIDER_MODEL",
  "TAKI_VLM_BASE_URL",
  "TAKI_VLM_API_KEY",
  "TAKI_VLM_MODEL",
  "TAKI_UTILITY_BASE_URL",
  "TAKI_UTILITY_API_KEY",
  "TAKI_UTILITY_MODEL",
  "TAKI_PROVIDER_CONTEXT_TOKENS",
  "TAKI_VLM_CONTEXT_TOKENS",
  "TAKI_UTILITY_CONTEXT_TOKENS",
  "TAKI_CONTEXT_HISTORY_RATIO",
  "TAKI_PROVIDER_INCLUDE_USAGE",
  "TAKI_COMPACT_TRIGGER_RATIO",
  "TAKI_COMPACT_KEEP_MESSAGES",
  "TAKI_MAX_STEPS",
  "TAKI_ATTACHMENT_TTL_DAYS",
  "TAKI_AMBIENT_SCREENSHOT",
  "TAKI_AMBIENT_SCREENSHOT_RETENTION",
  "TAKI_MEMORY_PINNED_BUDGET",
  "TAKI_MEMORY_BM25_WEIGHTS",
  "TAKI_MEMORY_STOPLIST",
  "TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS",
  "TAKI_MEMORY_TIDY_WRITE_THRESHOLD",
  "TAKI_MEMORY_TIDY_MAX_STEPS",
  "TAKI_MEMORY_TIDY_STALE_DAYS",
  "TAKI_MEMORY_TIDY_REPORT_CAP",
  "TAKI_HINDSIGHT_ENABLED",
  "TAKI_HINDSIGHT_DEPLOYMENT_MODE",
  "TAKI_HINDSIGHT_ENDPOINT",
  "TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS",
  "TAKI_HINDSIGHT_SETUP_TIMEOUT_MS",
  "TAKI_HINDSIGHT_TEMPLATE_REVISION",
  "TAKI_HINDSIGHT_MODEL_DEFAULT_PROVIDER",
  "TAKI_HINDSIGHT_MODEL_DEFAULT",
  "TAKI_HINDSIGHT_MODEL_RETAIN",
  "TAKI_HINDSIGHT_MODEL_REFLECT",
  "TAKI_HINDSIGHT_MODEL_CONSOLIDATION",
  "TAKI_HINDSIGHT_EMBEDDING_PROVIDER",
  "TAKI_HINDSIGHT_EMBEDDING_MODEL",
  "TAKI_HINDSIGHT_RERANKER_PROVIDER",
  "TAKI_HINDSIGHT_RERANKER_MODEL",
];

describe("CONFIG_KNOBS", () => {
  it("covers exactly the research table's knob set, with no duplicates", () => {
    const keys = CONFIG_KNOBS.map((knob) => knob.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(CONFIG_KNOBS).toHaveLength(60);
  });

  it("flags exactly the three API keys as secrets", () => {
    expect(CONFIG_KNOBS.filter((knob) => knob.secret).map((knob) => knob.key)).toEqual([
      "TAKI_PROVIDER_API_KEY",
      "TAKI_VLM_API_KEY",
      "TAKI_UTILITY_API_KEY",
    ]);
  });

  it("keeps apply metadata truthful for timing rows with and without current production consumers", () => {
    expect(CONFIG_KNOBS.filter((knob) => knob.apply === "env-only").map((knob) => knob.key)).toEqual(["TAKI_DATA_DIR"]);
    expect(CONFIG_KNOBS.filter((knob) => knob.apply === "live").map((knob) => knob.key)).toEqual([
      "TAKI_MONITOR_MODE",
      "TAKI_RECONNECT_BASE_MS",
      "TAKI_RECONNECT_CAP_MS",
      "TAKI_RECONNECT_STABILITY_RESET_MS",
      "TAKI_WS_OPEN_AUTH_TIMEOUT_MS",
      "TAKI_RPC_INTERACTIVE_TIMEOUT_MS",
      "TAKI_RPC_LONG_TIMEOUT_MS",
      "TAKI_CHAT_ACK_TIMEOUT_MS",
      "TAKI_PET_COSTUME_TOTAL_TIMEOUT_MS",
      "TAKI_RENDERER_LOAD_TIMEOUT_MS",
      "TAKI_HOME_RESULT_TIMEOUT_MS",
      "TAKI_HINDSIGHT_ENABLED",
      "TAKI_HINDSIGHT_DEPLOYMENT_MODE",
      "TAKI_HINDSIGHT_ENDPOINT",
      "TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS",
      "TAKI_HINDSIGHT_SETUP_TIMEOUT_MS",
      "TAKI_HINDSIGHT_TEMPLATE_REVISION",
      "TAKI_HINDSIGHT_MODEL_DEFAULT_PROVIDER",
      "TAKI_HINDSIGHT_MODEL_DEFAULT",
      "TAKI_HINDSIGHT_MODEL_RETAIN",
      "TAKI_HINDSIGHT_MODEL_REFLECT",
      "TAKI_HINDSIGHT_MODEL_CONSOLIDATION",
      "TAKI_HINDSIGHT_EMBEDDING_PROVIDER",
      "TAKI_HINDSIGHT_EMBEDDING_MODEL",
      "TAKI_HINDSIGHT_RERANKER_PROVIDER",
      "TAKI_HINDSIGHT_RERANKER_MODEL",
    ]);
  });

  it("every non-null default passes its own schema", () => {
    for (const knob of CONFIG_KNOBS) {
      if (knob.default === null) continue;
      expect({ key: knob.key, ok: knob.schema.safeParse(knob.default).success }).toEqual({ key: knob.key, ok: true });
    }
  });

  it("every row's input hint is a valid protocol ConfigInput and carries a description", () => {
    for (const knob of CONFIG_KNOBS) {
      expect(ConfigEntrySchema.shape.input.safeParse(knob.input).success).toBe(true);
      expect(knob.description.length).toBeGreaterThan(0);
    }
  });

  it("rejects out-of-range and wildcard values (the panel gets the loaders' fail-closed discipline)", () => {
    expect(findKnob("TAKI_WS_PORT")?.schema.safeParse(0).success).toBe(false);
    expect(findKnob("TAKI_WS_HOST")?.schema.safeParse("0.0.0.0").success).toBe(false);
    expect(findKnob("TAKI_MAX_STEPS")?.schema.safeParse(51).success).toBe(false);
    expect(findKnob("TAKI_CONTEXT_HISTORY_RATIO")?.schema.safeParse(1.5).success).toBe(false);
    expect(findKnob("TAKI_AMBIENT_SCREENSHOT_RETENTION")?.schema.safeParse("sometimes").success).toBe(false);
    expect(findKnob("TAKI_MEMORY_BM25_WEIGHTS")?.schema.safeParse("2,1").success).toBe(false);
    expect(findKnob("TAKI_MEMORY_STOPLIST")?.schema.safeParse("maybe").success).toBe(false);
    expect(findKnob("TAKI_RPC_INTERACTIVE_TIMEOUT_MS")?.schema.safeParse(0).success).toBe(false);
  });

  it("accepts the shapes the loaders accept", () => {
    expect(findKnob("TAKI_AMBIENT_SCREENSHOT_RETENTION")?.schema.safeParse("keep").success).toBe(true);
    expect(findKnob("TAKI_AMBIENT_SCREENSHOT_RETENTION")?.schema.safeParse("7").success).toBe(true);
    expect(findKnob("TAKI_MEMORY_BM25_WEIGHTS")?.schema.safeParse("2,1,2").success).toBe(true);
  });

  it("findKnob returns undefined for a key outside the registry", () => {
    expect(findKnob("TAKI_DEV_TRIGGER")).toBeUndefined();
  });
});
