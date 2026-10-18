import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HindsightTemplateJsonSchema, HindsightTemplateLabelsSchema, HindsightTemplateModelDefinitionSchema,
  HindsightTemplatePresenceSchema, HindsightTemplateSelectorsSchema } from "./hindsight-template-definition-schema.ts";
import { hindsightTemplateHashJson, normalizeHindsightTemplateSelectors } from "./hindsight-template-encoding.ts";

const model = { id: "taki-global-continuity-v1", name: "Continuity", source_query: "What changed?", tags: [], max_tokens: 1024, trigger: null };
describe("bounded template definitions", () => {
  it("matches the exact shared Python/TypeScript fixture vectors", () => {
    const vectors = JSON.parse(readFileSync(new URL("./fixtures/hindsight-template-vectors.json", import.meta.url), "utf8"));
    for (const vector of vectors) {
      const canonical = hindsightTemplateHashJson(vector.domain, vector.value);
      expect(canonical).toBe(vector.canonical);
      expect(createHash("sha256").update(canonical).digest("hex")).toBe(vector.hash);
    }
  });
  it("preserves complete optional trigger spelling and empty arrays", () => {
    const value = { ...model, trigger: { mode: "delta", exclude_mental_model_ids: [], tag_groups: [], response_schema: JSON.parse('{"properties":{"__proto__":{"type":"string"}}}') } };
    expect(HindsightTemplateModelDefinitionSchema.parse(value)).toEqual(value);
    const properties = HindsightTemplateModelDefinitionSchema.parse(value).trigger!.response_schema!.properties;
    expect(Object.hasOwn(properties as object, "__proto__")).toBe(true);
  });
  it("rejects unsupported trigger fields, impossible triggers and invalid native IDs", () => {
    expect(HindsightTemplateModelDefinitionSchema.safeParse({ ...model, id: "wrong_id" }).success).toBe(false);
    expect(HindsightTemplateModelDefinitionSchema.safeParse({ ...model, trigger: { fact_types: [] } }).success).toBe(false);
    expect(HindsightTemplateModelDefinitionSchema.safeParse({ ...model, trigger: { refresh_cron: "0 0 * * *", refresh_after_consolidation: true } }).success).toBe(false);
    expect(HindsightTemplateModelDefinitionSchema.safeParse({ ...model, trigger: { unknown: true } }).success).toBe(false);
  });
  it("keeps absent, tombstone and an explicit value distinct", () => {
    for (const value of [{ kind: "absent" }, { kind: "null_tombstone" }, { kind: "value", value: "" }]) {
      expect(HindsightTemplatePresenceSchema.parse(value)).toEqual(value);
    }
    expect(HindsightTemplatePresenceSchema.safeParse({ kind: "value", value: null }).success).toBe(false);
  });
  it("bounds UTF-8 rather than UTF-16 text and rejects lone surrogates", () => {
    expect(HindsightTemplateModelDefinitionSchema.safeParse({ ...model, name: "😀".repeat(128) }).success).toBe(true);
    expect(HindsightTemplateModelDefinitionSchema.safeParse({ ...model, name: "😀".repeat(129) }).success).toBe(false);
    expect(HindsightTemplateJsonSchema.safeParse("\ud800").success).toBe(false);
    expect(HindsightTemplateJsonSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(HindsightTemplateJsonSchema.safeParse(Array.from({ length: 257 }, () => null)).success).toBe(false);
  });
  it("preserves unrelated legacy label definitions and rejects duplicate group identities", () => {
    const value = [{ key: "native", free_values: true }, { key: "taki-layer", type: "value", tag: true, values: [{ value: "unclassified" }] }];
    expect(HindsightTemplateLabelsSchema.parse(value)).toEqual(value);
    expect(HindsightTemplateLabelsSchema.safeParse([...value, value[0]]).success).toBe(false);
  });
  it("sorts selector sets while refusing duplicates", () => {
    const selectors = { config_keys: ["reflect_mission", "retain_mission"], model_ids: ["z", "a"], directives: [] };
    expect(normalizeHindsightTemplateSelectors(HindsightTemplateSelectorsSchema.parse(selectors)).model_ids).toEqual(["a", "z"]);
    expect(HindsightTemplateSelectorsSchema.safeParse({ ...selectors, model_ids: ["a", "a"] }).success).toBe(false);
  });
  it("uses domain separation, scalar text and binary64 without mutating legacy encoding", () => {
    const value = JSON.parse('{"__proto__":null,"constructor":[],"😀":"雪","n":-0}');
    const hash = (domain: "definition" | "snapshot") => createHash("sha256").update(hindsightTemplateHashJson(domain, value)).digest("hex");
    expect(hash("definition")).not.toBe(hash("snapshot"));
    expect(hindsightTemplateHashJson("definition", value)).toBe(hindsightTemplateHashJson("definition", { ...value, n: 0 }));
  });
});
