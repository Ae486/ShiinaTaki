/**
 * INPUT:  candidate config.* params/result payloads (parsed WS frames from an operator surface)
 * OUTPUT: CONFIG_METHODS + knob-entry / list / set / changed schemas + ConfigRefusalReason
 * POS:    shared/protocol — the settings-store contract (invariants 3, 7); operator-only, NO Rust mirror. Values are
 *         JSON primitives; SECRET knobs never carry a value on this surface (set/not-set only)
 */
import { z } from "zod";

export const CONFIG_METHODS = {
  list: "config.list", // operator → core: every knob with its effective value + provenance
  set: "config.set", // operator → core: store a knob value (null = reset to env/default)
  subscribe: "config.subscribe", // operator → core: receive config.changed pushes
  changed: "config.changed", // core → operator: one knob's stored value changed
} as const;

/** A knob's value on the wire. Objects/arrays are deliberately excluded — every knob is one primitive. */
export const ConfigValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type ConfigValue = z.infer<typeof ConfigValueSchema>;

/** Consumer boundary and observed application state; a persisted value alone proves neither. */
export const ConfigApplicationSchema = z.object({
  boundary: z.enum(["immediate", "next-run", "next-operation", "component", "maintenance", "external", "bootstrap", "inapplicable"]),
  state: z.enum(["applied", "applying", "draft", "failed", "unavailable", "external", "inapplicable", "restart-required"]),
  activeValue: ConfigValueSchema.nullable(),
  message: z.string().optional(),
});
export type ConfigApplication = z.infer<typeof ConfigApplicationSchema>;

/**
 * When a stored change takes effect. `env-only` = a bootstrap knob the store cannot govern (read before the DB
 * opens); `restart` = stored now, honored at next boot; `live` = the consumption site re-reads per use.
 */
export const ConfigApplySchema = z.enum(["env-only", "restart", "live"]);
export type ConfigApply = z.infer<typeof ConfigApplySchema>;

/** Rendering hint for the settings panel — the panel never re-derives a knob's shape from its key. */
export const ConfigInputSchema = z.object({
  kind: z.enum(["boolean", "int", "number", "string", "enum"]),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string()).optional(),
});
export type ConfigInput = z.infer<typeof ConfigInputSchema>;

export const ConfigEntrySchema = z.object({
  key: z.string().min(1),
  /** Desired value (stored > env > default). ALWAYS null for a secret knob. */
  value: ConfigValueSchema.nullable(),
  origin: z.enum(["stored", "env", "default"]).optional(),
  application: ConfigApplicationSchema.optional(),
  /** A row exists in the config table (i.e. the operator set this). */
  stored: z.boolean(),
  /** Compatibility field: only bootstrap-only settings can be environment locked. */
  envLocked: z.boolean(),
  default: ConfigValueSchema.nullable(),
  apply: ConfigApplySchema,
  secret: z.boolean(),
  /** Secrets report presence only (invariant 5 — the value lives in the credential manager, never here). */
  secretSet: z.boolean(),
  input: ConfigInputSchema,
  description: z.string(),
});
export type ConfigEntry = z.infer<typeof ConfigEntrySchema>;

export const ConfigListParamsSchema = z.object({});
export type ConfigListParams = z.infer<typeof ConfigListParamsSchema>;
export const ConfigListResultSchema = z.object({ entries: z.array(ConfigEntrySchema) });
export type ConfigListResult = z.infer<typeof ConfigListResultSchema>;

export const ConfigSetParamsSchema = z.object({
  key: z.string().min(1),
  /** null deletes the stored row — the knob falls back to env/default. */
  value: ConfigValueSchema.nullable(),
});
export type ConfigSetParams = z.infer<typeof ConfigSetParamsSchema>;

export const ConfigSetResultSchema = z.object({
  status: z.literal("ok"),
  key: z.string().min(1),
  value: ConfigValueSchema.nullable(),
  /** Resolved echo after the write, including environment fallback on reset. Secrets remain null. */
  effectiveValue: ConfigValueSchema.nullable().optional(),
  origin: z.enum(["stored", "env", "default"]).optional(),
  application: ConfigApplicationSchema.optional(),
  /** What the operator must do for it to take effect — the panel states this truthfully. */
  apply: ConfigApplySchema,
});
export type ConfigSetResult = z.infer<typeof ConfigSetResultSchema>;

/**
 * Why a config.set was refused. Rides `error.data.reason` beside the CONFIG_REFUSED ErrorCode — five distinct,
 * machine-readable refusals so the panel can explain itself without string-matching a message.
 */
export const ConfigRefusalReasonSchema = z.enum(["unknown-key", "invalid-value", "env-locked", "secret", "env-only"]);
export type ConfigRefusalReason = z.infer<typeof ConfigRefusalReasonSchema>;

export const ConfigSubscribeParamsSchema = z.object({});
export type ConfigSubscribeParams = z.infer<typeof ConfigSubscribeParamsSchema>;
export const ConfigSubscribeResultSchema = z.object({ status: z.literal("ok") });
export type ConfigSubscribeResult = z.infer<typeof ConfigSubscribeResultSchema>;

export const ConfigChangedSchema = z.object({ key: z.string().min(1), value: ConfigValueSchema.nullable() });
export type ConfigChanged = z.infer<typeof ConfigChangedSchema>;
