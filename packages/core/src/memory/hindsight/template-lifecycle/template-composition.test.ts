import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadTakiBankTemplate, takiBankTemplateDigest } from "../taki-bank-template-v1.ts";
import { loadManagedTemplate, TAKI_MANAGED_TEMPLATE_REVISION } from "./template-catalog.ts";
import { previewTemplateOverlay } from "./template-preview.ts";
import { captureTemplateEnrollment, selectTemplateResources } from "./template-enrollment.ts";
import { emptyTemplateUserRevision } from "./template-overlay-schema.ts";
import { deriveTemplateOwnership } from "./template-receipt.ts";
import { templateHash } from "./template-integrity.ts";
import { templateFixture, fixtureCommit, signFixtureSnapshot, fixtureProof, customModel } from "./template-test-fixtures.ts";

function applied(fixture: ReturnType<typeof templateFixture>) {
  const commit = fixtureCommit(fixture.preview);
  return { ...commit, previous: { projection: fixture.preview.projection, ownership: deriveTemplateOwnership(null, fixture.preview.request) } };
}

describe("immutable catalog and independent explicit user composition", () => {
  it.each(["global", "character"] as const)("preserves v1 and derives the %s scope registry", (scope) => {
    const legacy = loadTakiBankTemplate("taki-bank-v1", scope); const before = takiBankTemplateDigest(legacy);
    expect(before).toBe(scope === "global" ? "feb8350d679658bfbb426426d1539b26df1551e37fc4afbb43c759479b627537"
      : "55bf2c07e2bf6c93fa393bb74677029310a67977da35bba6ed4df7dd915aec0f");
    const v2 = loadManagedTemplate("taki-bank-v2", scope);
    expect(templateHash("definition", v2)).toBe(scope === "global" ? "ab5b6584715cacc34b25bddedcbd326897e74e8330b4cd45d59b609d4a59b08b"
      : "ae04cbe36c061760dbd2172cba1297698c256058c318c158934131dca098e183");
    expect(v2.config).toEqual(legacy.manifest.bank);
    const entry = loadManagedTemplate(TAKI_MANAGED_TEMPLATE_REVISION, scope);
    expect(entry.config.retain_mission).not.toBe(v2.config.retain_mission);
    expect({ ...entry, revision: v2.revision, config: { ...entry.config, retain_mission: v2.config.retain_mission } }).toEqual(v2);
    expect(entry.labelGroup).toMatchObject({ key: "taki-layer", type: "value", optional: true, tag: true });
    expect(entry.labelGroup.values?.map((item) => item.value)).toEqual(scope === "global"
      ? ["profile", "activity", "unclassified"] : ["relationship", "episodes", "intentions", "unclassified"]);
    for (const revision of ["taki-bank-v2", TAKI_MANAGED_TEMPLATE_REVISION]) {
      const before = loadManagedTemplate(revision, scope);
      const detached = loadManagedTemplate(revision, scope);
      detached.config.retain_mission = "caller changed"; detached.labelGroup.values?.pop();
      expect(loadManagedTemplate(revision, scope)).toEqual(before);
    }
    expect(takiBankTemplateDigest(loadTakiBankTemplate("taki-bank-v1", scope))).toBe(before);
    expect(() => loadManagedTemplate("taki-bank-v1", scope)).toThrow("TEMPLATE_INVALID");
  });

  it("preserves an explicit equal-to-old value across template update, removal and reset", () => {
    const f = templateFixture(); const first = applied(f);
    const user = { ...f.user, revision: 1, config: [{ key: "retain_mission" as const,
      choice: { mode: "value" as const, value: f.template.config.retain_mission } }] };
    const update = previewTemplateOverlay({ ...f.input, ...first, user, requestId: randomUUID(),
      template: { ...f.template, revision: "fixture-v3", config: { ...f.template.config, retain_mission: "new Taki value" } } });
    expect(update.projection.config.find((item) => item.key === "retain_mission")?.stored)
      .toEqual({ kind: "value", value: f.template.config.retain_mission });
    const removal = previewTemplateOverlay({ ...f.input, ...first, user, template: null });
    expect(removal.projection.config.find((item) => item.key === "retain_mission")?.stored)
      .toEqual({ kind: "value", value: f.template.config.retain_mission });
    const reset = previewTemplateOverlay({ ...f.input, ...first, template: null, user: { ...user, revision: 2,
      config: [{ key: "retain_mission", choice: { mode: "inherit" } }] } });
    expect(reset.projection.config.every((item) => item.stored.kind === "absent")).toBe(true);
  });

  it.each(["absent", "null_tombstone"] as const)("keeps user label values/suppression after Taki removal and restores %s only on final reset", (presence) => {
    const f = templateFixture();
    f.snapshot.config.find((item) => item.key === "entity_labels")!.stored = { kind: presence };
    f.snapshot = signFixtureSnapshot(f.snapshot); f.enrollment = captureTemplateEnrollment({ identity: f.identity, snapshot: f.snapshot, mode: "fresh" });
    const user = { ...f.user, revision: 1, labels: [{ key: "parent-group", choice: { mode: "suppress" as const } },
      { key: "my-group", choice: { mode: "value" as const, value: { key: "my-group", type: "text" as const } } }] };
    const install = previewTemplateOverlay({ ...f.input, enrollment: f.enrollment, snapshot: f.snapshot, user });
    const installed = fixtureCommit(install);
    const previous = { projection: install.projection, ownership: deriveTemplateOwnership(null, install.request) };
    const removal = previewTemplateOverlay({ ...f.input, enrollment: f.enrollment, snapshot: installed.snapshot, previous, user, template: null });
    expect(removal.projection.config.find((item) => item.key === "entity_labels")?.stored)
      .toEqual({ kind: "value", value: [{ key: "my-group", type: "text" }] });
    expect(removal.request.changes.config.map((item) => item.key)).not.toContain("entities_allow_free_form");
    const removed = fixtureCommit(removal);
    const reset = previewTemplateOverlay({ ...f.input, enrollment: f.enrollment, snapshot: removed.snapshot,
      previous: { projection: removal.projection, ownership: deriveTemplateOwnership(previous.ownership, removal.request) },
      template: null, user: { ...emptyTemplateUserRevision(), revision: 2 } });
    expect(reset.projection.config.find((item) => item.key === "entity_labels")?.stored).toEqual({ kind: presence });
  });

  it("pins an explicit label value even when it equals the inherited group", () => {
    const f = templateFixture(); const user = { ...f.user, revision: 1,
      labels: [{ key: "parent-group", choice: { mode: "value" as const, value: { key: "parent-group", type: "text" as const } } }] };
    const preview = previewTemplateOverlay({ ...f.input, template: null, user });
    expect(preview.projection.config.find((item) => item.key === "entity_labels")?.stored.kind).toBe("value");
  });

  it("preserves complete model values including empty tags/trigger after Taki removal", () => {
    const f = templateFixture(); const first = applied(f); const definition = customModel(f.template.models[0]!.id);
    const user = { ...f.user, revision: 1, models: [{ id: definition.id, choice: { mode: "value" as const, value: definition } }] };
    const removal = previewTemplateOverlay({ ...f.input, ...first, user, template: null });
    expect(removal.request.changes.models).toEqual([{ kind: "upsert", definition }]);
    expect(removal.projection.models[0]!.definition).toEqual(definition);
    expect(removal.consequences.deletions.map((item) => item.kind)).toEqual(["directive"]);
  });

  it("keeps explicit suppression through a new template and uses exact complete deletion proofs", () => {
    const f = templateFixture();
    f.input.template = loadManagedTemplate("taki-bank-v2", "global");
    f.preview = previewTemplateOverlay(f.input);
    const first = applied(f);
    const user = { ...f.user, revision: 1, config: [{ key: "retain_mission" as const, choice: { mode: "suppress" as const } },
      { key: "reflect_mission" as const, choice: { mode: "suppress" as const } }],
      models: [{ id: f.template.models[0]!.id, choice: { mode: "suppress" as const } }],
      labels: [{ key: "taki-layer", choice: { mode: "suppress" as const } }] };
    const preview = previewTemplateOverlay({ ...f.input, ...first, user, template: loadManagedTemplate(TAKI_MANAGED_TEMPLATE_REVISION, "global") });
    expect(preview.request.changes.models).toEqual([{ kind: "delete", id: f.template.models[0]!.id,
      deletion_hash: first.snapshot.models[0]!.proof!.deletion_hash }]);
    expect(preview.consequences.deletions[0]).toMatchObject({ historyCount: 2, dependencyCount: 3, hasGeneratedContent: true });
    expect(preview.projection.config.find((item) => item.key === "retain_mission")?.stored).toEqual({ kind: "value", value: "" });
    expect(preview.projection.config.find((item) => item.key === "reflect_mission")?.stored).toEqual({ kind: "value", value: "" });
    expect(preview.projection.config.find((item) => item.key === "entity_labels")?.stored)
      .toEqual({ kind: "value", value: [{ key: "parent-group", type: "text" }] });
  });
});

describe("enrollment, exact ownership and drift", () => {
  it("requires reviewed existing-base enrollment and restores definitions without deleting the base", () => {
    const f = templateFixture(); const definition = customModel(f.template.models[0]!.id);
    const snapshot = signFixtureSnapshot({ ...f.snapshot, models: [{ id: definition.id, definition, proof: fixtureProof(definition) }] });
    expect(() => captureTemplateEnrollment({ identity: f.identity, snapshot, mode: "fresh" })).toThrow("TEMPLATE_CONFLICT");
    expect(() => captureTemplateEnrollment({ identity: f.identity, snapshot, mode: "reviewed-existing" })).toThrow("TEMPLATE_CONFLICT");
    const enrollment = captureTemplateEnrollment({ identity: f.identity, snapshot, mode: "reviewed-existing", reviewedSnapshotHash: snapshot.snapshot_hash });
    const preview = previewTemplateOverlay({ ...f.input, enrollment, snapshot }); const commit = fixtureCommit(preview);
    const previous = { projection: preview.projection, ownership: deriveTemplateOwnership(null, preview.request) };
    expect(previous.ownership.models).toEqual([]);
    const removal = previewTemplateOverlay({ ...f.input, enrollment, ...commit, previous, template: null });
    expect(removal.request.changes.models).toEqual([{ kind: "upsert", definition }]);
    expect(() => previewTemplateOverlay({ ...f.input, enrollment, ...commit, previous, user: { ...f.user, revision: 1,
      models: [{ id: definition.id, choice: { mode: "suppress" } }] } })).toThrow("TEMPLATE_CONFLICT");
  });

  it("preserves an explicitly reviewed Bank override and original label wrapper on removal", () => {
    const f = templateFixture(); const snapshot = signFixtureSnapshot({ ...f.snapshot, config: f.snapshot.config.map((item) => ({ ...item,
      stored: { kind: "value" as const, value: item.key === "entity_labels" ? { attributes: [{ key: "local", type: "text" }] } : "original Bank override" } })) });
    expect(() => captureTemplateEnrollment({ identity: f.identity, snapshot, mode: "fresh" })).toThrow("TEMPLATE_CONFLICT");
    const enrollment = captureTemplateEnrollment({ identity: f.identity, snapshot, mode: "reviewed-existing", reviewedSnapshotHash: snapshot.snapshot_hash });
    const preview = previewTemplateOverlay({ ...f.input, snapshot, enrollment }); const commit = fixtureCommit(preview);
    const removal = previewTemplateOverlay({ ...f.input, enrollment, ...commit, template: null,
      previous: { projection: preview.projection, ownership: deriveTemplateOwnership(null, preview.request) } });
    expect(removal.projection.config).toEqual(snapshot.config);
  });

  it("keeps a complete explicit directive with empty tags after removing Taki", () => {
    const f = templateFixture(); const first = applied(f); const definition = { ...first.snapshot.directives[0]!.definition!,
      content: "User-owned complete directive", priority: -10, is_active: false, tags: [] };
    const user = { ...f.user, revision: 1, directives: [{ id: definition.id, name: definition.name,
      choice: { mode: "value" as const, value: definition } }] };
    const removed = previewTemplateOverlay({ ...f.input, ...first, user, template: null });
    expect(removed.projection.directives[0]?.definition).toEqual(definition);
    expect(removed.request.changes.directives).toEqual([{ kind: "upsert", definition }]);
  });

  it("refuses untracked legacy, ambiguous directive names and a different UUID occupying the name", () => {
    const f = templateFixture();
    expect(() => captureTemplateEnrollment({ identity: f.identity, snapshot: f.snapshot, mode: "untracked" })).toThrow("TEMPLATE_CONFLICT");
    for (const matches of [[randomUUID()], [f.snapshot.directives[0]!.id, randomUUID()]]) {
      const snapshot = signFixtureSnapshot({ ...f.snapshot, directives: f.snapshot.directives.map((item) => ({ ...item, name_matches: matches })) });
      expect(() => captureTemplateEnrollment({ identity: f.identity, snapshot, mode: "reviewed-existing",
        reviewedSnapshotHash: snapshot.snapshot_hash })).toThrow("TEMPLATE_CONFLICT");
    }
  });

  it("requires fresh review after external definition or inherited parent drift", () => {
    const f = templateFixture(); const first = applied(f);
    const parent = signFixtureSnapshot({ ...first.snapshot, config: first.snapshot.config.map((item) => item.key === "entity_labels"
      ? { ...item, inherited: [{ key: "changed-parent", type: "text" }] } : item) });
    expect(() => previewTemplateOverlay({ ...f.input, ...first, snapshot: parent })).toThrow("TEMPLATE_CONFLICT");
    const reviewed = previewTemplateOverlay({ ...f.input, ...first, snapshot: parent, reviewedDriftSnapshotHash: parent.snapshot_hash });
    expect(reviewed.projection.config.find((item) => item.key === "entity_labels")?.stored)
      .toMatchObject({ value: [{ key: "changed-parent" }, { key: "taki-layer" }] });
    const definition = { ...first.snapshot.models[0]!.definition!, source_query: "external edit" };
    const changed = signFixtureSnapshot({ ...first.snapshot, models: [{ id: definition.id, definition, proof: fixtureProof(definition, 3) }] });
    expect(() => previewTemplateOverlay({ ...f.input, ...first, snapshot: changed })).toThrow("TEMPLATE_CONFLICT");
    expect(() => previewTemplateOverlay({ ...f.input, ...first, snapshot: changed,
      reviewedDriftSnapshotHash: changed.snapshot_hash })).toThrow("TEMPLATE_CONFLICT");
    expect(() => previewTemplateOverlay({ ...f.input, ...first, snapshot: changed,
      reviewedDriftSnapshotHash: changed.snapshot_hash, user: { ...f.user, revision: 1,
        models: [{ id: definition.id, choice: { mode: "value", value: definition } }] } })).not.toThrow();
  });

  it("requires explicit adoption to retain externally added unrelated label groups during removal", () => {
    const f = templateFixture(); const first = applied(f);
    const label = first.snapshot.config.find((item) => item.key === "entity_labels")!;
    const external = { key: "external", type: "text" as const };
    const values = label.stored.kind === "value" && Array.isArray(label.stored.value) ? label.stored.value : [];
    const snapshot = signFixtureSnapshot({ ...first.snapshot, config: first.snapshot.config.map((item) => item.key === "entity_labels"
      ? { ...item, stored: { kind: "value" as const, value: [...values, external] } } : item) });
    const input = { ...f.input, ...first, snapshot, template: null, reviewedDriftSnapshotHash: snapshot.snapshot_hash };
    expect(() => previewTemplateOverlay(input)).toThrow("TEMPLATE_CONFLICT");
    const preview = previewTemplateOverlay({ ...input, user: { ...f.user, revision: 1,
      labels: [{ key: "external", choice: { mode: "value", value: external } }] } });
    expect(preview.projection.config.find((item) => item.key === "entity_labels")?.stored)
      .toEqual({ kind: "value", value: [{ key: "parent-group", type: "text" }, external] });
  });

  it("extends immutable before-images for a new complete user resource without inventing old coverage", () => {
    const f = templateFixture(); const first = applied(f); const definition = customModel();
    const user = { ...f.user, revision: 1, models: [{ id: definition.id, choice: { mode: "value" as const, value: definition } }] };
    const selectors = selectTemplateResources({ template: f.template, user, directiveIds: [], enrollment: f.enrollment });
    const snapshot = signFixtureSnapshot({ ...first.snapshot, selectors,
      models: [...first.snapshot.models, { id: definition.id, definition: null, proof: null }] });
    expect(() => previewTemplateOverlay({ ...f.input, ...first, snapshot, user })).toThrow("TEMPLATE_CONFLICT");
    const enrollment = captureTemplateEnrollment({ identity: f.identity, snapshot, mode: "fresh", previous: f.enrollment });
    expect(enrollment.captures[0]).toEqual(f.enrollment.captures[0]);
    const preview = previewTemplateOverlay({ ...f.input, ...first, enrollment, snapshot, user, template: null });
    expect(preview.projection.models.find((item) => item.id === definition.id)?.definition).toEqual(definition);
    const drifted = signFixtureSnapshot({ ...snapshot, models: snapshot.models.map((item) => item.id === definition.id
      ? { ...item, definition, proof: fixtureProof(definition) } : item) });
    expect(() => previewTemplateOverlay({ ...f.input, ...first, enrollment, snapshot: drifted, user,
      reviewedDriftSnapshotHash: drifted.snapshot_hash })).toThrow("TEMPLATE_CONFLICT");
  });
});
