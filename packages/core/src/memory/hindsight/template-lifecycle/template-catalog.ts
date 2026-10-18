/**
 * INPUT:  an admitted scope and immutable built-in catalog revision
 * OUTPUT: complete template contributions, including the registry-derived optional layer group
 * POS:    Core template preview/default provisioning catalog; immutable legacy v1 remains unchanged
 */
import { z } from "zod";
import { HindsightTemplateModelDefinitionSchema, HindsightTemplateDirectiveDefinitionSchema,
  HindsightTemplateLabelGroupSchema, HindsightTemplateTextSchema } from "@taki/shared";
import { V1_MEMORY_LAYERS } from "../../layer-registry.ts";
import { loadTakiBankTemplate, TAKI_BANK_TEMPLATE_REVISION } from "../taki-bank-template-v1.ts";
import { templateHash } from "./template-integrity.ts";

export const TAKI_MANAGED_TEMPLATE_REVISION = "taki-bank-v2";
export const TemplateCatalogEntrySchema = z.strictObject({
  revision: z.string().min(1).max(256), scope: z.enum(["global", "character"]),
  config: z.strictObject({ retain_mission: HindsightTemplateTextSchema,
    observations_instructions: HindsightTemplateTextSchema, reflect_mission: HindsightTemplateTextSchema }),
  models: z.array(HindsightTemplateModelDefinitionSchema).max(64),
  directives: z.array(HindsightTemplateDirectiveDefinitionSchema.omit({ id: true })).max(64),
  labelGroup: HindsightTemplateLabelGroupSchema,
}).refine((value) => value.revision !== "none" && value.revision !== TAKI_BANK_TEMPLATE_REVISION
  && new Set(value.models.map((item) => item.id)).size === value.models.length
  && new Set(value.directives.map((item) => item.name)).size === value.directives.length
  && value.labelGroup.key === "taki-layer" && value.labelGroup.type === "value"
  && value.labelGroup.optional === true && value.labelGroup.tag === true, "invalid managed catalog ownership");
export type TemplateCatalogEntry = z.infer<typeof TemplateCatalogEntrySchema>;

// Cache immutable bytes at module initialization. A caller receives a detached value,
// and cannot mutate the catalog for a later Bank. New definitions need a new revision.
const CATALOG = new Map(["global", "character"].map((scope) => {
  const entry = buildEntry(scope === "global" ? "global" : "character");
  const digest = entry.scope === "global" ? "ab5b6584715cacc34b25bddedcbd326897e74e8330b4cd45d59b609d4a59b08b"
    : "ae04cbe36c061760dbd2172cba1297698c256058c318c158934131dca098e183";
  if (templateHash("definition", entry) !== digest) throw new Error("HINDSIGHT_TEMPLATE_INVALID");
  return [entry.scope, JSON.stringify(entry)] as const;
}));

export function loadManagedTemplate(revision: string, scope: TemplateCatalogEntry["scope"]): TemplateCatalogEntry {
  const bytes = CATALOG.get(scope);
  if (revision !== TAKI_MANAGED_TEMPLATE_REVISION || !bytes) throw new Error("HINDSIGHT_TEMPLATE_INVALID");
  return TemplateCatalogEntrySchema.parse(JSON.parse(bytes));
}

function buildEntry(scope: TemplateCatalogEntry["scope"]): TemplateCatalogEntry {
  const legacy = loadTakiBankTemplate(TAKI_BANK_TEMPLATE_REVISION, scope).manifest;
  const ownership = scope === "global" ? "global" : "per-character";
  return TemplateCatalogEntrySchema.parse({ revision: TAKI_MANAGED_TEMPLATE_REVISION, scope,
    config: legacy.bank,
    models: legacy.mental_models?.map((model) => ({ ...model, trigger: model.trigger ?? null })),
    directives: legacy.directives,
    labelGroup: { key: "taki-layer", type: "value", optional: true, tag: true,
      description: "Classify each fact only when its scope and meaning are clear. Use unclassified when uncertain. A label grants no pin, disclosure or visibility permission.",
      values: [...V1_MEMORY_LAYERS.filter((layer) => layer.ownership === ownership).map((layer) => ({ value: layer.id })),
        { value: "unclassified" }] },
  });
}
