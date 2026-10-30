/**
 * INPUT:  n/a (declarative rows) — the env-var vocabulary the core's loaders already parse
 * OUTPUT: CONFIG_KNOBS (ordered rows) + findKnob(key) + Knob/KnobApply types
 * POS:    core/config — the SINGLE source the config store, the resolver and config.list render from (#26 batch 1).
 *         One row per operator-visible knob; adding a knob is one row, and its `apply` class is the one-line upgrade
 *         path from "restart to apply" to live-apply once the consumption site re-reads per use
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { z, type ZodType } from "zod";
import {
  DEFAULT_WS_HOST,
  DEFAULT_WS_PORT,
  MONITOR_MODE_CONFIG_KEY,
  TIMING_CONFIG_KEYS,
  TIMING_POLICY_DEVELOPMENT_DEFAULTS,
  TimingDurationMsSchema,
  type ConfigApply,
  type ConfigInput,
  type ConfigValue,
  type TimingPolicyField,
} from "@taki/shared";
import { DEFAULT_MAX_STEPS } from "./agent-config.ts";
import { INITIATIVE_POLICY_FIELDS } from "./initiative-policy-config.ts";
import { INITIATIVE_WAKE_KNOBS } from "./initiative-wake-knobs.ts";
import { VIEWING_INVITATION_KNOBS } from "./viewing-invitation-config.ts";
import { INTENTION_WINDOW_KNOB } from "./initiative-intention-config.ts";
import { DEFAULT_HINDSIGHT_POLICY_PROMPT, DEFAULT_HINDSIGHT_POLICY_TIMEOUT_MS } from "./hindsight-policy-config.ts";
import { DEFAULT_TTL_DAYS } from "./attachment-config.ts";
import { AVATAR_OUTCOME_DEADLINE_KEY, DEFAULT_AVATAR_OUTCOME_DEADLINE_MS } from "./avatar-config.ts";
import { DEFAULT_COMPACT_KEEP_MESSAGES, DEFAULT_COMPACT_TRIGGER_RATIO, DEFAULT_CONTEXT_TOKENS, DEFAULT_HISTORY_RATIO } from "./context-config.ts";
import { DEFAULT_LOG_LEVEL, DEFAULT_TRUST_LOOPBACK, LOG_LEVELS } from "./server-config.ts";
import {
  DEFAULT_INTENTIONS_DAYS,
  DEFAULT_PINNED_BUDGET,
  DEFAULT_TIDY_MAX_STEPS,
  DEFAULT_TIDY_REPORT_CAP,
  DEFAULT_TIDY_STALE_DAYS,
  DEFAULT_TIDY_WRITE_THRESHOLD,
} from "./memory-config.ts";

export type KnobApply = ConfigApply;

export interface Knob {
  /** The env-var name; it is also the config-table key, so one vocabulary governs env, store and panel. */
  key: string;
  /** Validates a value ARRIVING from the panel (the env-string parse stays in each loader). */
  schema: ZodType<ConfigValue>;
  /** The built-in fallback, or null when the knob has none (an unset optional slot / a machine-derived path). */
  default: ConfigValue | null;
  apply: KnobApply;
  /** Never stored, never returned — the credential manager owns it (invariant 5). */
  secret?: boolean;
  input: ConfigInput;
  description: string;
}

const DAYS_OR_MODE = /^(drop|keep|[1-9]\d*)$/;
const BM25_CSV = /^\s*\d+(\.\d+)?\s*(,\s*\d+(\.\d+)?\s*){2}$/;

interface RangeHint {
  min?: number;
  max?: number;
}

function int(range: RangeHint = {}): Pick<Knob, "schema" | "input"> {
  let schema = z.int();
  if (range.min !== undefined) schema = schema.min(range.min);
  if (range.max !== undefined) schema = schema.max(range.max);
  return { schema, input: { kind: "int", ...range } };
}

/** 0 < ratio <= 1 — the shape the history slice and the compaction trigger share. */
function ratio(): Pick<Knob, "schema" | "input"> {
  return { schema: z.number().positive().max(1), input: { kind: "number", max: 1 } };
}

function str(): Pick<Knob, "schema" | "input"> {
  return { schema: z.string().min(1), input: { kind: "string" } };
}

function bool(): Pick<Knob, "schema" | "input"> {
  return { schema: z.boolean(), input: { kind: "boolean" } };
}

function choice(options: readonly [string, ...string[]]): Pick<Knob, "schema" | "input"> {
  return { schema: z.enum(options), input: { kind: "enum", options: [...options] } };
}

function timing(field: TimingPolicyField, apply: KnobApply, description: string): Knob {
  return {
    key: TIMING_CONFIG_KEYS[field],
    schema: TimingDurationMsSchema,
    input: { kind: "int", min: 1 },
    default: TIMING_POLICY_DEVELOPMENT_DEFAULTS[field],
    apply,
    description,
  };
}

/** A free-form string knob whose grammar the loader also enforces; the panel gets the same fail-closed check. */
function pattern(spec: { regex: RegExp; message: string }): Pick<Knob, "schema" | "input"> {
  return { schema: z.string().regex(spec.regex, spec.message), input: { kind: "string" } };
}

export const CONFIG_KNOBS: Knob[] = [
  ...INITIATIVE_WAKE_KNOBS,
  INTENTION_WINDOW_KNOB,
  { key: "TAKI_INITIATIVE_ENABLED", ...bool(), default: false, apply: "live", description: "Enable Class B initiative admission and delivery; requires a valid Core opportunity source." },
  ...Object.entries(INITIATIVE_POLICY_FIELDS).map(([field, entry]): Knob => ({ ...entry,
    ...int({ min: 1, max: 2_147_483_647 }), apply: "live",
    description: `Initiative ${field}; effective for later admissions and publication checks.` })),
  // --- server / bootstrap ---
  {
    key: "TAKI_WS_HOST",
    schema: z.string().min(1).refine((host) => host !== "0.0.0.0" && host !== "::", "wildcard binds are not allowed"),
    input: { kind: "string" },
    default: DEFAULT_WS_HOST,
    apply: "restart",
    description: "WS bind address (loopback only — wildcard binds are refused).",
  },
  { key: "TAKI_WS_PORT", ...int({ min: 1, max: 65535 }), default: DEFAULT_WS_PORT, apply: "restart", description: "WS listen port." },
  { key: "TAKI_LOG_LEVEL", ...choice(LOG_LEVELS), default: DEFAULT_LOG_LEVEL, apply: "restart", description: "Log verbosity." },
  {
    key: "TAKI_DATA_DIR",
    ...str(),
    default: join(homedir(), ".takiagent"),
    // Read before the database exists, so the store can never govern it — the panel shows it locked.
    apply: "env-only",
    description: "App data root (db, workspace, devices). Bootstrap value — env only.",
  },
  { key: "TAKI_PROMPT_DIR", ...str(), default: null, apply: "restart", description: "Prompt-card library root; unset uses the bundled prompt/ tree." },
  { key: "TAKI_TRUST_LOOPBACK_OPERATOR", ...bool(), default: DEFAULT_TRUST_LOOPBACK, apply: "restart", description: "Auto-trust loopback operators (off forces pairing)." },
  { key: MONITOR_MODE_CONFIG_KEY, ...choice(["DISABLED", "FEEDBACK_ONLY", "FULL_LOCAL"]), default: "DISABLED", apply: "live", description: "Local developer Run monitor mode; disabled hides the Home monitor." },

  // --- desktop connection and cross-window operation timing (development-tunable; final defaults need runtime data) ---
  timing("reconnectBaseMs", "live", "Initial reconnect backoff delay in milliseconds."),
  timing("reconnectCapMs", "live", "Maximum reconnect backoff delay in milliseconds."),
  timing("reconnectStabilityResetMs", "live", "Authenticated stability period before reconnect backoff resets."),
  timing("openAuthMs", "live", "Combined WebSocket open and authentication deadline in milliseconds."),
  timing("interactiveRpcMs", "live", "Deadline for interactive/read JSON-RPC requests in milliseconds."),
  timing("longRpcMs", "live", "Deadline for import and maintenance JSON-RPC work in milliseconds."),
  timing("chatAckMs", "live", "Deadline for chat.send acknowledgement in milliseconds; stream completion is separate."),
  timing("petCostumeTotalMs", "live", "Whole pet costume-attempt budget captured when each D61 switch begins."),
  timing("rendererLoadMs", "live", "Live2D renderer load deadline in milliseconds."),
  timing("homeResultMs", "live", "Home wait for the pet costume result in milliseconds."),

  // --- model slots (the three API keys are credential-manager material, never stored here) ---
  { key: "TAKI_PROVIDER_BASE_URL", ...str(), default: null, apply: "restart", description: "Main chat provider base URL." },
  { key: "TAKI_PROVIDER_API_KEY", ...str(), default: null, apply: "restart", secret: true, description: "Main chat provider API key." },
  { key: "TAKI_PROVIDER_MODEL", ...str(), default: null, apply: "restart", description: "Main chat model id." },
  { key: "TAKI_VLM_BASE_URL", ...str(), default: null, apply: "restart", description: "Vision slot base URL; the whole slot is all-or-nothing." },
  { key: "TAKI_VLM_API_KEY", ...str(), default: null, apply: "restart", secret: true, description: "Vision slot API key." },
  { key: "TAKI_VLM_MODEL", ...str(), default: null, apply: "restart", description: "Vision model id; unset disables vision." },
  { key: "TAKI_UTILITY_BASE_URL", ...str(), default: null, apply: "restart", description: "Background/utility slot base URL; all-or-nothing." },
  { key: "TAKI_UTILITY_API_KEY", ...str(), default: null, apply: "restart", secret: true, description: "Background/utility slot API key." },
  { key: "TAKI_UTILITY_MODEL", ...str(), default: null, apply: "restart", description: "Background model id; unset rides the main model." },

  // --- context window + compaction ---
  { key: "TAKI_PROVIDER_CONTEXT_TOKENS", ...int({ min: 1 }), default: DEFAULT_CONTEXT_TOKENS, apply: "restart", description: "Declared context window of the main slot." },
  { key: "TAKI_VLM_CONTEXT_TOKENS", ...int({ min: 1 }), default: DEFAULT_CONTEXT_TOKENS, apply: "restart", description: "Declared context window of the vision slot." },
  { key: "TAKI_UTILITY_CONTEXT_TOKENS", ...int({ min: 1 }), default: DEFAULT_CONTEXT_TOKENS, apply: "restart", description: "Declared context window of the utility slot." },
  { key: "TAKI_CONTEXT_HISTORY_RATIO", ...ratio(), default: DEFAULT_HISTORY_RATIO, apply: "restart", description: "Share of the window replayed as history." },
  { key: "TAKI_PROVIDER_INCLUDE_USAGE", ...bool(), default: false, apply: "restart", description: "Ask the provider for streaming usage numbers." },
  { key: "TAKI_COMPACT_TRIGGER_RATIO", ...ratio(), default: DEFAULT_COMPACT_TRIGGER_RATIO, apply: "restart", description: "Complete projected-input fill that triggers compaction." },
  { key: "TAKI_COMPACT_KEEP_MESSAGES", ...int({ min: 1 }), default: DEFAULT_COMPACT_KEEP_MESSAGES, apply: "restart", description: "Newest messages compaction keeps live." },

  // --- agent loop + media ---
  { key: "TAKI_MAX_STEPS", ...int({ min: 1, max: 50 }), default: DEFAULT_MAX_STEPS, apply: "restart", description: "Tool-loop step cap per turn." },
  { key: "TAKI_ATTACHMENT_TTL_DAYS", ...int({ min: 1 }), default: DEFAULT_TTL_DAYS, apply: "restart", description: "Days raw attachment bytes are kept (descriptions are permanent)." },
  // Read on every avatar tool call (the outcomes factory takes a deadline reader), hence live.
  { key: AVATAR_OUTCOME_DEADLINE_KEY, ...int({ min: 100, max: 10_000 }), default: DEFAULT_AVATAR_OUTCOME_DEADLINE_MS, apply: "live", description: "How long an avatar tool waits for the Pet window's presentation outcome." },

  // --- ambient perception (privacy) ---
  { key: "TAKI_BROWSER_PLAYBACK_ENABLED", ...bool(), default: false, apply: "live", description: "Accept selected browser playback observations from paired Hosts; Privacy Pause still applies." },
  ...VIEWING_INVITATION_KNOBS,
  { key: "TAKI_AMBIENT_SCREENSHOT", ...bool(), default: false, apply: "restart", description: "Enable ambient screen sampling (default off)." },
  {
    key: "TAKI_AMBIENT_SCREENSHOT_RETENTION",
    ...pattern({ regex: DAYS_OR_MODE, message: 'expected "drop", "keep" or a positive number of days' }),
    default: "drop",
    apply: "restart",
    description: 'Raw ambient frames: "drop" after describe, "keep", or a day count.',
  },

  // --- memory engine ---
  { key: "TAKI_MEMORY_PINNED_BUDGET", ...int({ min: 1 }), default: DEFAULT_PINNED_BUDGET, apply: "restart", description: "Token safety valve for the pinned memory region." },
  {
    key: "TAKI_MEMORY_BM25_WEIGHTS",
    ...pattern({ regex: BM25_CSV, message: "expected three positive numbers: disclosure,content,searchTerms" }),
    default: "2,1,2",
    apply: "restart",
    description: "bm25 column weights: disclosure,content,searchTerms.",
  },
  { key: "TAKI_MEMORY_STOPLIST", ...choice(["on", "off"]), default: "on", apply: "restart", description: "Stop-word filtering in the memory segmenter." },
  { key: "TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS", ...int({ min: 1 }), default: DEFAULT_INTENTIONS_DAYS, apply: "restart", description: "Fallback lifetime of an intention with no explicit expiry." },
  { key: "TAKI_MEMORY_TIDY_WRITE_THRESHOLD", ...int({ min: 1 }), default: DEFAULT_TIDY_WRITE_THRESHOLD, apply: "restart", description: "New memory writes that trigger a tidy pass." },
  { key: "TAKI_MEMORY_TIDY_MAX_STEPS", ...int({ min: 1 }), default: DEFAULT_TIDY_MAX_STEPS, apply: "restart", description: "Step ceiling for one tidy pass." },
  { key: "TAKI_MEMORY_TIDY_STALE_DAYS", ...int({ min: 1 }), default: DEFAULT_TIDY_STALE_DAYS, apply: "restart", description: "Age at which a never-recalled memory becomes a tidy candidate." },
  { key: "TAKI_MEMORY_TIDY_REPORT_CAP", ...int({ min: 1 }), default: DEFAULT_TIDY_REPORT_CAP, apply: "restart", description: "Per-class candidate cap in the tidy report." },

  // --- inactive Hindsight setup plane (B3; does not select Memory Authority) ---
  { key: "TAKI_HINDSIGHT_ENABLED", ...bool(), default: false, apply: "live", description: "Allow explicit Hindsight validation and setup actions." },
  { key: "TAKI_HINDSIGHT_DEPLOYMENT_MODE", ...choice(["existing-instance", "managed-helper"]), default: "existing-instance", apply: "live", description: "Connection ownership mode; Core never performs managed host actions." },
  { key: "TAKI_HINDSIGHT_ENDPOINT", ...str(), default: null, apply: "live", description: "Explicit authenticated Hindsight base endpoint." },
  { key: "TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", ...int({ min: 250, max: 120_000 }), default: 10_000, apply: "live", description: "Deadline for one Hindsight REST request." },
  { key: "TAKI_HINDSIGHT_SETUP_TIMEOUT_MS", ...int({ min: 250, max: 120_000 }), default: 120_000, apply: "live", description: "Total deadline for one explicit setup action." },
  { key: "TAKI_HINDSIGHT_TEMPLATE_REVISION", ...str(), default: "taki-bank-v1", apply: "live", description: "Desired versioned Taki Bank Template revision." },
  { key: "TAKI_HINDSIGHT_MODEL_DEFAULT_PROVIDER", ...str(), default: null, apply: "live", description: "Desired managed-deployment default provider identifier." },
  { key: "TAKI_HINDSIGHT_MODEL_DEFAULT", ...str(), default: null, apply: "live", description: "Desired managed-deployment default model identifier." },
  { key: "TAKI_HINDSIGHT_MODEL_RETAIN", ...str(), default: null, apply: "live", description: "Optional managed-deployment retain model override." },
  { key: "TAKI_HINDSIGHT_MODEL_REFLECT", ...str(), default: null, apply: "live", description: "Optional managed-deployment reflect model override." },
  { key: "TAKI_HINDSIGHT_MODEL_CONSOLIDATION", ...str(), default: null, apply: "live", description: "Optional managed-deployment consolidation model override." },
  { key: "TAKI_HINDSIGHT_EMBEDDING_PROVIDER", ...str(), default: null, apply: "live", description: "Desired managed-deployment embedding provider identifier." },
  { key: "TAKI_HINDSIGHT_EMBEDDING_MODEL", ...str(), default: null, apply: "live", description: "Desired managed-deployment embedding model identifier." },
  { key: "TAKI_HINDSIGHT_RERANKER_PROVIDER", ...str(), default: null, apply: "live", description: "Desired managed-deployment reranker provider identifier." },
  { key: "TAKI_HINDSIGHT_RERANKER_MODEL", ...str(), default: null, apply: "live", description: "Desired managed-deployment reranker model identifier." },
  { key: "TAKI_HINDSIGHT_POLICY_TIMEOUT_MS", ...int({ min: 1, max: 2_147_483_647 }), default: DEFAULT_HINDSIGHT_POLICY_TIMEOUT_MS,
    apply: "live", description: "Whole-pass deadline for the narrow Hindsight policy curator; captured at each pass." },
  { key: "TAKI_HINDSIGHT_POLICY_PROMPT", schema: z.string(), input: { kind: "string" }, default: DEFAULT_HINDSIGHT_POLICY_PROMPT,
    apply: "live", description: "Additional Hindsight policy review instructions; the fixed ownership and safety rules remain in force." },
];

const BY_KEY = new Map(CONFIG_KNOBS.map((knob) => [knob.key, knob]));

export function findKnob(key: string): Knob | undefined {
  return BY_KEY.get(key);
}
