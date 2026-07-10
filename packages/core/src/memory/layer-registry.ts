/**
 * INPUT:  n/a (declarative data) — validated at module load
 * OUTPUT: MemoryLayerDefinitionSchema + V1_MEMORY_LAYERS + selectors (getLayer, WRITABLE_LAYER_IDS, isWritableLayer)
 * POS:    core/memory — the layer taxonomy as DATA (invariant 7); the engine reads ONLY these fields, adding a layer = a row
 */
import { z } from "zod";

// Retention: permanent | rolling window (rollingDays) | expiring (per-entry `expires`). Data, not code branches.
const RetentionSchema = z.union([
  z.literal("permanent"),
  z.object({ rollingDays: z.int().positive() }).strict(),
  z.literal("expiring"),
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
    retention: "permanent",
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
