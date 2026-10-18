/**
 * INPUT:  explicit operator customization above the independently versioned Taki contribution
 * OUTPUT: the single transport/storage schema for complete per-Bank user choices and revisions
 * POS:    shared template lifecycle — inheritance, suppression and explicit equal values remain distinct
 */
import { z } from "zod";
import {
  HindsightTemplateConfigKeySchema, HindsightTemplateDirectiveDefinitionSchema, HindsightTemplateLabelGroupSchema,
  HindsightTemplateModelDefinitionSchema, HindsightTemplateModelIdSchema, HindsightTemplateNameSchema, HindsightTemplateTextSchema,
} from "./hindsight-template-definition-schema.ts";

const Reset = z.strictObject({ mode: z.literal("inherit") });
const Suppress = z.strictObject({ mode: z.literal("suppress") });
const ConfigEdit = z.strictObject({
  key: HindsightTemplateConfigKeySchema.exclude(["entity_labels"]),
  choice: z.discriminatedUnion("mode", [Reset, Suppress, z.strictObject({ mode: z.literal("value"), value: HindsightTemplateTextSchema })]),
});
const LabelEdit = z.strictObject({ key: HindsightTemplateNameSchema,
  choice: z.discriminatedUnion("mode", [Reset, Suppress, z.strictObject({ mode: z.literal("value"), value: HindsightTemplateLabelGroupSchema })]),
}).refine((value) => value.choice.mode !== "value" || value.key === value.choice.value.key);
const ModelEdit = z.strictObject({ id: HindsightTemplateModelIdSchema,
  choice: z.discriminatedUnion("mode", [Reset, Suppress, z.strictObject({ mode: z.literal("value"), value: HindsightTemplateModelDefinitionSchema })]),
}).refine((value) => value.choice.mode !== "value" || value.id === value.choice.value.id);
const DirectiveEdit = z.strictObject({ id: z.uuid().transform((value) => value.toLowerCase()), name: HindsightTemplateNameSchema,
  choice: z.discriminatedUnion("mode", [Reset, Suppress, z.strictObject({ mode: z.literal("value"), value: HindsightTemplateDirectiveDefinitionSchema })]),
}).refine((value) => value.choice.mode !== "value" || value.id === value.choice.value.id && value.name === value.choice.value.name);

const Choices = z.strictObject({
  config: z.array(ConfigEdit).max(3), labels: z.array(LabelEdit).max(32),
  models: z.array(ModelEdit).max(64), directives: z.array(DirectiveEdit).max(64),
});
function uniqueChoices(value: z.infer<typeof Choices>, context: z.RefinementCtx): void {
  const lists = [value.config.map((item) => item.key), value.labels.map((item) => item.key),
    value.models.map((item) => item.id), value.directives.map((item) => item.id), value.directives.map((item) => item.name)];
  if (lists.some((items) => new Set(items).size !== items.length)) context.addIssue({ code: "custom", message: "duplicate user identities" });
}
export const MemoryTemplateUserChoicesSchema = Choices.superRefine(uniqueChoices);
export type MemoryTemplateUserChoices = z.infer<typeof MemoryTemplateUserChoicesSchema>;
export const MemoryTemplateUserRevisionSchema = Choices.extend({ revision: z.int().min(0) }).superRefine(uniqueChoices);
export type MemoryTemplateUserRevision = z.infer<typeof MemoryTemplateUserRevisionSchema>;
