/**
 * INPUT:  n/a (declarative data) — validated at module load
 * OUTPUT: MemoryLayerDefinitionSchema + V1_MEMORY_LAYERS + selectors (getLayer, WRITABLE_LAYER_IDS, isWritableLayer,
 *         AUTO_WRITABLE_LAYER_IDS)
 * POS:    core/memory — the layer taxonomy as DATA (invariant 7); the engine reads ONLY these fields, adding a layer = a row
 */
import { z } from "zod";

// Retention: permanent | rolling window (rollingDays) | expiring (per-entry `expires`) | importance-decay
// (archive a low-importance entry once it is old). Data, not code branches — the sweeper reads these rows only.
const RetentionSchema = z.union([
  z.literal("permanent"),
  z.object({ rollingDays: z.int().positive() }).strict(),
  z.literal("expiring"),
  z.object({ archiveBelowImportance: z.int().min(1).max(10), afterDays: z.int().positive() }).strict(),
]);

export const MemoryLayerDefinitionSchema = z
  .object({
    id: z.string().min(1),
    ownership: z.enum(["global", "per-character"]),
    writePolicy: z.enum(["explicit-tool", "machine", "agent", "consolidation"]),
    recallPolicy: z.enum(["pinned", "retrieved", "mood-gated"]),
    // Retrieved layers may still pin their high-importance entries (profile: >= 9).
    pinnedImportanceThreshold: z.int().min(1).max(10).optional(),
    truncatable: z.boolean(),
    retention: RetentionSchema,
  })
  .strict();
export type MemoryLayerDefinition = z.infer<typeof MemoryLayerDefinitionSchema>;

// v1 taxonomy (MEMORY-DESIGN §v1 layer registry). Editing a row reshapes a layer; the engine never changes.
export const V1_MEMORY_LAYERS: readonly MemoryLayerDefinition[] = z.array(MemoryLayerDefinitionSchema).parse([
  {
    id: "profile",
    ownership: "global",
    writePolicy: "explicit-tool",
    recallPolicy: "retrieved",
    pinnedImportanceThreshold: 9,
    truncatable: true,
    retention: "permanent",
  },
  {
    id: "activity",
    ownership: "global",
    writePolicy: "machine",
    recallPolicy: "retrieved",
    truncatable: true,
    retention: { rollingDays: 30 },
  },
  {
    id: "relationship",
    ownership: "per-character",
    writePolicy: "explicit-tool",
    recallPolicy: "pinned",
    truncatable: false, // the never-truncate guarantee (promises/rules) rides this flag, not a special case
    retention: "permanent",
  },
  {
    id: "episodes",
    ownership: "per-character",
    writePolicy: "agent",
    recallPolicy: "retrieved",
    truncatable: true,
    // T5-R8: an episode below the importance cut ARCHIVES once it is old (never deletes — a misjudged archive is
    // recoverable, files stay on disk). Both numbers are LOCAL choices with no external source: 4 sits just under the
    // episodic writer's mid band and 90 days is a season. Tune them here — they are registry data, not code.
    retention: { archiveBelowImportance: 4, afterDays: 90 },
  },
  {
    id: "intentions",
    ownership: "per-character",
    writePolicy: "agent",
    recallPolicy: "mood-gated",
    truncatable: true,
    retention: "expiring",
  },
]);

const LAYERS_BY_ID = new Map(V1_MEMORY_LAYERS.map((layer) => [layer.id, layer]));

export function getLayer(id: string): MemoryLayerDefinition | undefined {
  return LAYERS_BY_ID.get(id);
}

// The LLM may write only layers whose writePolicy invites it (explicit-tool | agent); derived, never hardcoded.
export const WRITABLE_LAYER_IDS: readonly string[] = V1_MEMORY_LAYERS.filter(
  (layer) => layer.writePolicy === "explicit-tool" || layer.writePolicy === "agent",
).map((layer) => layer.id);

export function isWritableLayer(id: string): boolean {
  return WRITABLE_LAYER_IDS.includes(id);
}

// The AUTOMATIC writer may choose only writable layers that are NOT pinned by policy (T5 Q11-1): a pinned-policy
// layer grants always-visible status at ANY importance, so allowing it would mint rung-1 visibility that the
// importance clamp cannot take back. Always-visible stays deliberate — the user's card, her explicit pin, or tidy.
export const AUTO_WRITABLE_LAYER_IDS: readonly string[] = V1_MEMORY_LAYERS.filter(
  (layer) => isWritableLayer(layer.id) && layer.recallPolicy !== "pinned",
).map((layer) => layer.id);
