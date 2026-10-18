import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { HindsightTemplateConfigEntrySchema, HindsightTemplateLabelsSchema, HindsightTemplateModelDefinitionSchema } from "./hindsight-template-definition-schema.ts";
import { HindsightTemplateChangesSchema } from "./hindsight-template-schema.ts";

const cases: { kind: "trigger" | "labels" | "config"; name: string; value: unknown; accepted: boolean }[] =
  JSON.parse(readFileSync(new URL("./fixtures/hindsight-template-validation-cases.json", import.meta.url), "utf8"));
const model = { id: "test-model", name: "Test", source_query: "Query", tags: [], max_tokens: 1024 };

it.each(cases)("matches Native lifecycle validation: $name", ({ kind, value, accepted }) => {
  const result = kind === "trigger" ? HindsightTemplateModelDefinitionSchema.safeParse({ ...model, trigger: value })
    : kind === "labels" ? HindsightTemplateLabelsSchema.safeParse(value)
      : HindsightTemplateChangesSchema.safeParse({ config: [value], models: [], directives: [] });
  expect(result.success).toBe(accepted);
  if (result.success) {
    if (kind === "trigger") expect(HindsightTemplateModelDefinitionSchema.parse({ ...model, trigger: value }).trigger).toEqual(value);
    else if (kind === "labels") expect(result.data).toEqual(value);
    else expect(HindsightTemplateChangesSchema.parse({ config: [value], models: [], directives: [] }).config).toEqual([value]);
  }
  if (kind === "config" && value !== null && typeof value === "object") {
    expect(HindsightTemplateConfigEntrySchema.safeParse({ ...value, inherited: null }).success).toBe(accepted);
  }
});
