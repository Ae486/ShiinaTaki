import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HindsightTemplateModelDefinitionSchema, HindsightTemplateSelectorsSchema, normalizeHindsightTemplateSnapshot } from "@taki/shared";
import { templateHash, templateEqual, signTemplateRequest, verifyTemplateSnapshot } from "./template-integrity.ts";
import { templateFixture, fixtureCommit, signFixtureSnapshot, fixtureProof, customModel } from "./template-test-fixtures.ts";
import { previewTemplateOverlay } from "./template-preview.ts";
import { verifyTemplateApplication } from "./template-receipt.ts";
import { TemplateUserRevisionSchema } from "./template-overlay-schema.ts";

describe("complete lifecycle hashing, proof and bounds", () => {
  it("hashes every complete trigger field and preserves empty tags, Unicode and prototype-like keys", () => {
    const definition = customModel(); const before = templateHash("definition", definition);
    const variants = [
      { ...definition, tags: ["user"] }, { ...definition, trigger: null },
      { ...definition, trigger: { ...definition.trigger, refresh_cron: "0 1 * * *" } },
      { ...definition, trigger: { ...definition.trigger, recall_chunks_max_tokens: 2048 } },
      { ...definition, trigger: { ...definition.trigger, response_schema: JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"},"😀":{"type":"string","description":"非ASCII"}}}') } },
      { ...definition, trigger: { ...definition.trigger, tag_groups: [{ not: { tags: ["private"], match: "all" as const } }] } },
    ];
    for (const value of variants) expect(templateHash("definition", HindsightTemplateModelDefinitionSchema.parse(value))).not.toBe(before);
    const proto = JSON.parse('{"__proto__":1,"constructor":2,"😀":3}');
    expect(templateEqual(proto, { constructor: 2, "😀": 3 })).toBe(false);
    expect(templateHash("definition", { kind: "absent" })).not.toBe(templateHash("definition", { kind: "null_tombstone" }));
  });

  it("normalizes selector sets but preserves ordered tags and array semantics", () => {
    const f = templateFixture(); const shuffled = { ...f.snapshot, config: [...f.snapshot.config].reverse(),
      selectors: { ...f.snapshot.selectors, config_keys: [...f.snapshot.selectors.config_keys].reverse() } };
    expect(verifyTemplateSnapshot(shuffled)).toEqual(normalizeHindsightTemplateSnapshot(f.snapshot));
    expect(templateHash("definition", ["a", "b"])).not.toBe(templateHash("definition", ["b", "a"]));
    expect(signTemplateRequest({ ...f.preview.request, expected_snapshot: shuffled }).request_hash).toBe(f.preview.request.request_hash);
  });

  it("rejects omitted/duplicate selectors and tampered complete definition proofs even with a recomputed snapshot hash", () => {
    const f = templateFixture();
    expect(() => verifyTemplateSnapshot(signFixtureSnapshot({ ...f.snapshot, config: f.snapshot.config.slice(1) }))).toThrow("RESPONSE_INVALID");
    expect(() => verifyTemplateSnapshot(signFixtureSnapshot({ ...f.snapshot, config: [...f.snapshot.config, f.snapshot.config[0]!] }))).toThrow();
    const model = customModel(f.snapshot.models[0]!.id); const proof = fixtureProof(model);
    expect(() => verifyTemplateSnapshot(signFixtureSnapshot({ ...f.snapshot,
      models: [{ id: model.id, definition: { ...model, trigger: null }, proof }] }))).toThrow("RESPONSE_INVALID");
  });

  it("refuses unsupported/oversized definitions without truncating any before-image", () => {
    const f = templateFixture();
    expect(() => HindsightTemplateSelectorsSchema.parse({ ...f.snapshot.selectors, model_ids: Array.from({ length: 65 }, (_, i) => `model-${i}`) })).toThrow();
    expect(() => HindsightTemplateModelDefinitionSchema.parse({ ...customModel(), source_query: "😀".repeat(5001) })).toThrow();
    expect(() => HindsightTemplateModelDefinitionSchema.parse({ ...customModel(), trigger: { mode: "future-mode" } })).toThrow();
    expect(() => HindsightTemplateModelDefinitionSchema.parse({ ...customModel(), tags: ["\uD800"] })).toThrow();
    expect(() => HindsightTemplateModelDefinitionSchema.parse({ ...customModel(), trigger: { recall_max_tokens: Number.MAX_SAFE_INTEGER + 1 } })).toThrow();
    const user = { ...f.user, revision: 1, config: [{ key: "retain_mission", choice: { mode: "value", value: "x" } },
      { key: "retain_mission", choice: { mode: "inherit" } }] };
    expect(() => TemplateUserRevisionSchema.parse(user)).toThrow();
    expect(() => signTemplateRequest({ ...f.preview.request, refresh: Array.from({ length: 65 }, () => ({ model_id: "m", child_id: randomUUID() })) })).toThrow();
  });

  it("binds refresh/deletion choices and reports provider work only when explicitly requested", () => {
    const f = templateFixture(); expect(f.preview.consequences.providerWork).toEqual([]);
    const refresh = [{ model_id: f.template.models[0]!.id, child_id: randomUUID() }];
    const preview = previewTemplateOverlay({ ...f.input, refresh }); const commit = fixtureCommit(preview);
    expect(preview.request.request_hash).not.toBe(f.preview.request.request_hash);
    expect(preview.consequences.providerWork).toEqual(refresh);
    expect(() => verifyTemplateApplication({ preview, ...commit })).not.toThrow();
    expect(() => verifyTemplateApplication({ preview: f.preview, ...commit })).toThrow("RESPONSE_INVALID");
    expect(() => previewTemplateOverlay({ ...f.input, refresh: [{ model_id: "not-selected", child_id: randomUUID() }] })).toThrow("TEMPLATE_CONFLICT");
    commit.receipt.children[0]!.child_id = randomUUID();
    expect(() => verifyTemplateApplication({ preview, ...commit })).toThrow("RESPONSE_INVALID");
  });

  it("does not mutate caller snapshots, selections or user revisions during preview", () => {
    const f = templateFixture(); const before = JSON.stringify(f.input);
    const preview = previewTemplateOverlay(f.input);
    preview.request.changes.config[0]!.stored = { kind: "null_tombstone" };
    expect(JSON.stringify(f.input)).toBe(before);
  });

  it("admits current matching definitions after refresh while retaining the original receipt and child proof", () => {
    const f = templateFixture(); const preview = previewTemplateOverlay({ ...f.input,
      refresh: [{ model_id: f.template.models[0]!.id, child_id: randomUUID() }] });
    const commit = fixtureCommit(preview); const original = structuredClone(commit.receipt);
    const refreshed = signFixtureSnapshot({ ...commit.snapshot, models: commit.snapshot.models.map((item) => ({ ...item,
      proof: fixtureProof(item.definition, 3) })) });
    expect(refreshed.snapshot_hash).not.toBe(commit.receipt.after_snapshot_hash);
    expect(() => verifyTemplateApplication({ preview, receipt: commit.receipt, snapshot: refreshed })).not.toThrow();
    expect(commit.receipt).toEqual(original);
    const stale = signFixtureSnapshot({ ...refreshed, models: refreshed.models.map((item) => ({ ...item, proof: fixtureProof(item.definition, 1) })) });
    expect(() => verifyTemplateApplication({ preview, receipt: commit.receipt, snapshot: stale })).toThrow("RESPONSE_INVALID");
  });
});
