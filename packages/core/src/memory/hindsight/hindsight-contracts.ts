/**
 * INPUT:  untrusted JSON returned by the exact Hindsight 0.9.0 endpoints used by B3 and the lifecycle occupancy probe
 * OUTPUT: bounded raw-wire schemas and safe projected Core types
 * POS:    core/memory/hindsight — the only Hindsight response-validation vocabulary
 */
import { z } from "zod";
import { HindsightCompatibilitySupportSchema, HindsightApplicationStateContractSchema,
  HindsightApplicationReflectContractSchema } from "@taki/shared";

const text = z.string().min(1).max(512);
const support = z.object({
  state: z.enum(["supported", "unsupported"]),
  reason: HindsightCompatibilitySupportSchema.shape.reason,
});
const versioned = z.object({ version: text, support });

export const HindsightHealthWireSchema = z.object({
  status: z.literal("healthy"),
  database: z.literal("connected"),
});
export const HindsightVersionWireSchema = z.object({ api_version: text });
export const HindsightCompatibilityWireSchema = z.object({
  base_api_version: text,
  compatibility_version: text,
  source_identity: z.object({ upstream_commit: text, compatibility_build: text }),
  provider: z.object({
    lineage: z.string().uuid().nullable(),
    database_dialect: z.enum(["postgresql", "oracle", "unknown"]),
    storage_mode: z.enum(["sql_rows", "alternative_store", "unknown"]),
  }),
  support,
  journal: z.object({
    schema_version: z.number().int().nonnegative(),
    retention_mode: z.literal("operator_managed_cursor_floor"),
    cursor_reset_supported: z.boolean(),
  }),
  snapshot: z.object({
    schema_version: z.number().int().nonnegative(),
    default_page_size: z.number().int().positive(),
    max_page_size: z.number().int().positive(),
    default_ttl_seconds: z.number().int().positive(),
    max_ttl_seconds: z.number().int().positive(),
  }),
  contracts: z.object({
    change_journal: versioned,
    conditional_mutation: versioned,
    logical_snapshot: versioned,
    additive_observation_instructions: versioned,
    controlled_layer_projection: versioned,
    native_results: versioned.optional(),
    current_state_transfer: versioned.optional(),
    cutover_verification: versioned.optional(),
    application_state: HindsightApplicationStateContractSchema.optional(),
    application_reflect: HindsightApplicationReflectContractSchema.optional(),
    transitions: versioned.optional(),
    transition_source_evidence: versioned.nullable().optional(),
  }),
});
export type HindsightCompatibilityWire = z.infer<typeof HindsightCompatibilityWireSchema>;

const templateText = z.string().min(1).max(20_000);
const labels = z.array(z.object({
  key: text,
  description: templateText.optional(),
  type: z.enum(["value", "multi-values", "text", "map"]).optional(),
  optional: z.boolean().optional(),
  tag: z.boolean().optional(),
  values: z.array(z.object({ value: text, description: templateText.optional() })).max(64).optional(),
}).passthrough()).max(32);
export const HindsightBankTemplateManifestSchema = z.object({
  version: z.literal("1"),
  bank: z.object({
    reflect_mission: templateText.nullable().optional(),
    retain_mission: templateText.nullable().optional(),
    observations_instructions: templateText.nullable().optional(),
    entity_labels: labels.nullable().optional(),
    entities_allow_free_form: z.boolean().nullable().optional(),
  }).passthrough().nullable().optional(),
  mental_models: z.array(z.object({
    id: text.regex(/^[a-z0-9][a-z0-9-]*$/), name: text, source_query: templateText,
    tags: z.array(text).max(32).optional(), max_tokens: z.number().int().positive().max(32_000).optional(),
  }).passthrough()).max(64).nullable().optional(),
  directives: z.array(z.object({
    name: text, content: templateText, priority: z.number().int().min(-1000).max(1000).optional(),
    is_active: z.boolean().optional(), tags: z.array(text).max(32).optional(),
  }).passthrough()).max(64).nullable().optional(),
}).passthrough();
export type HindsightBankTemplateManifest = z.infer<typeof HindsightBankTemplateManifestSchema>;

export const HindsightBankWireSchema = z.object({ bank_id: text, name: z.string().max(512).optional().nullable() });
export const HindsightTemplateImportWireSchema = z.object({
  bank_id: text,
  config_applied: z.boolean(),
  mental_models_created: z.array(text).max(64).optional(),
  mental_models_updated: z.array(text).max(64).optional(),
  directives_created: z.array(text).max(64).optional(),
  directives_updated: z.array(text).max(64).optional(),
  operation_ids: z.array(text).max(64).optional(),
  dry_run: z.boolean().optional(),
});
export type HindsightTemplateImportWire = z.infer<typeof HindsightTemplateImportWireSchema>;

export const HindsightBankLlmHealthWireSchema = z.object({
  bank_id: text,
  operations: z.array(z.object({
    operation: z.enum(["retain", "consolidation", "reflect"]),
    ok: z.boolean(),
    status: z.enum(["connected", "not_configured", "auth_failed", "unreachable", "timeout"]),
    latency_ms: z.number().int().nonnegative().max(120_000).nullable().optional(),
  })).max(3),
});
export const HindsightOperationStatusWireSchema = z.object({
  operation_id: text,
  status: z.enum(["pending", "processing", "completed", "failed", "cancelled", "not_found"]),
});
/** Only the counters the occupancy rule reads; native stats aggregate by bank_id, so an absent Bank answers zeros. */
export const HindsightBankStatsWireSchema = z.object({
  bank_id: text,
  total_nodes: z.int().nonnegative(),
  total_documents: z.int().nonnegative(),
  total_observations: z.int().nonnegative(),
  pending_operations: z.int().nonnegative(),
});
export type HindsightBankStatsWire = z.infer<typeof HindsightBankStatsWireSchema>;
