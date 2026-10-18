import { describe, expect, it } from "vitest";
import { MemoryTemplateUserChoicesSchema } from "@taki/shared";
import { newResourceDraft, resourceChoice } from "./hindsight-template-resource-form.tsx";
import { EMPTY_TEMPLATE_CHOICES } from "./hindsight-template-state.ts";

const complete = MemoryTemplateUserChoicesSchema.parse({
  config: [{ key: "retain_mission", choice: { mode: "value", value: "Same as the selected template" } }],
  labels: [{ key: "user-facets", choice: { mode: "value", value: { key: "user-facets", type: "map", optional: false, tag: false,
    description: "Preserve the complete nested definition", free_values: true, multi_value: false,
    fields: { tone: { type: "multi-values", values: [{ value: "warm", description: "A deliberate user choice" }] } } } } }],
  models: [{ id: "user-model", choice: { mode: "value", value: { id: "user-model", name: "User model", source_query: "User query", tags: ["user:full", "keep:tag"],
    max_tokens: 8192, trigger: { mode: "delta", refresh_cron: "0 3 * * *", fact_types: ["world", "observation"], exclude_mental_models: true,
      exclude_mental_model_ids: ["another-model"], tags_match: "all_strict", tag_groups: [{ and: [{ tags: ["x"], match: "any" }, { not: { tags: ["y"] } }] }],
      include_chunks: false, recall_max_tokens: 4096, recall_chunks_max_tokens: 256, keep_trace: true,
      response_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } } } } }],
  directives: [{ id: "11111111-1111-4111-8111-111111111111", name: "User directive", choice: { mode: "value", value: {
    id: "11111111-1111-4111-8111-111111111111", name: "User directive", content: "Do preserve this exact instruction", priority: -27, is_active: false, tags: ["private:choice"] } } }],
});

describe("explicit template resource drafts", () => {
  it("round-trips full nested labels, model triggers and directive fields without dropping explicit equal config", () => {
    for (const family of ["labels", "models", "directives"] as const) {
      const edited = resourceChoice(complete, newResourceDraft(family, complete[family][0]!));
      expect(edited).toEqual(complete);
      expect(edited.config[0]!.choice).toEqual({ mode: "value", value: "Same as the selected template" });
    }
  });

  it("keeps suppress and inherit explicit even when hidden definition fields are invalid", () => {
    for (const mode of ["suppress", "inherit"] as const) {
      const draft = { ...newResourceDraft("models", complete.models[0]), mode, tags: "broken JSON", advanced: "broken JSON" };
      const result = resourceChoice(complete, draft);
      expect(result.models).toEqual([{ id: "user-model", choice: { mode } }]);
      expect(result.labels).toEqual(complete.labels); expect(result.directives).toEqual(complete.directives);
    }
  });

  it("rejects accidental duplicate additions and identity changes instead of silently replacing an existing choice", () => {
    const existing = newResourceDraft("models", complete.models[0]);
    expect(() => resourceChoice(complete, { ...existing, originalId: null })).toThrow("duplicates");
    expect(() => resourceChoice(complete, { ...existing, id: "different-id" })).toThrow("identity");
    const duplicateName = { ...newResourceDraft("directives", complete.directives[0]), id: "22222222-2222-4222-8222-222222222222", originalId: null };
    expect(() => resourceChoice(complete, duplicateName)).toThrow();
  });

  it("rejects incomplete, out-of-range and malformed resource definitions before changing user intent", () => {
    const model = { ...newResourceDraft("models"), id: "new-model", name: "New model", text: "A complete query" };
    for (const patch of [{ maxTokens: "" }, { maxTokens: "10" }, { maxTokens: "1.5" }, { tags: "[1]" }, { advanced: '{"invented":true}' }]) {
      expect(() => resourceChoice(EMPTY_TEMPLATE_CHOICES, { ...model, ...patch })).toThrow();
    }
    const directive = { ...newResourceDraft("directives"), name: "New directive", text: "Complete content", priority: "" };
    expect(() => resourceChoice(EMPTY_TEMPLATE_CHOICES, directive)).toThrow();
    expect(EMPTY_TEMPLATE_CHOICES).toEqual({ config: [], labels: [], models: [], directives: [] });
  });

  it("validates simple label values while preserving advanced field identity", () => {
    const label = { ...newResourceDraft("labels"), id: "favorite", text: "blue\ngreen" };
    expect(resourceChoice(EMPTY_TEMPLATE_CHOICES, label).labels[0]?.choice).toMatchObject({ mode: "value", value: { key: "favorite", values: [{ value: "blue" }, { value: "green" }] } });
    expect(() => resourceChoice(EMPTY_TEMPLATE_CHOICES, { ...label, text: "blue\nblue" })).toThrow();
    expect(() => resourceChoice(EMPTY_TEMPLATE_CHOICES, { ...label, advanced: '{"key":"different"}' })).toThrow();
  });
});
