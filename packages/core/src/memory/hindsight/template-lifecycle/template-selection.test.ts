import { afterEach, describe, expect, it } from "vitest";
import type { MemoryTemplatePreviewParams, MemoryTemplateUserChoices } from "@taki/shared";
import { readMemoryAuthoritySelection } from "../../legacy-migration/legacy-activation-repo.ts";
import { loadManagedTemplate, TAKI_MANAGED_TEMPLATE_REVISION } from "./template-catalog.ts";
import { readTemplateDefaults } from "./template-default-store.ts";
import { readAppliedTemplateSelection } from "./template-overlay-store.ts";
import { readTemplateUser } from "./template-overlay-history.ts";
import { templateLifecycleFixture, type TemplateLifecycleFixture } from "./template-lifecycle-fixtures.ts";
import { customModel } from "./template-test-fixtures.ts";

const fixtures: TemplateLifecycleFixture[] = [];
const fixture = () => { const f = templateLifecycleFixture(); fixtures.push(f); return f; };
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

const emptyChoices = (): MemoryTemplateUserChoices => ({ config: [], labels: [], models: [], directives: [] });
function bankParams(bankId: string, templateRevision: string, userChoices: MemoryTemplateUserChoices | null): MemoryTemplatePreviewParams {
  return { target: { kind: "bank", bankId, templateRevision, userChoices }, enrollment: "fresh", directives: [], refresh: [] };
}
async function apply(f: TemplateLifecycleFixture, params = f.params()) {
  const operation = f.owner.submit(await f.request(params)); await f.owner.stop();
  expect(f.owner.status(operation.operationId)).toMatchObject({ state: "completed", result: { outcome: "bound" } });
  return f.plan(operation);
}

describe("explicit user decisions through production template operations", () => {
  it("keeps Character customization local and preserves equal values and suppression across the next scope default", async () => {
    const f = fixture(); const initialParams = f.params();
    if (initialParams.target.kind !== "defaults") throw new Error("expected defaults");
    initialParams.target.globalTemplateRevision = "taki-bank-v2"; initialParams.target.characterTemplateRevision = "taki-bank-v2";
    const initial = await apply(f, initialParams);
    const character = initial.banks.find((bank) => bank.identity.scope === "character")!;
    const global = initial.banks.find((bank) => bank.identity.scope === "global")!;
    const originalGlobal = readAppliedTemplateSelection(f.db, global.identity);
    const defaults = readTemplateDefaults(f.db, initial.guard.providerLineage);
    const originalValue = character.template!.config.retain_mission;
    const choices: MemoryTemplateUserChoices = { ...emptyChoices(),
      config: [{ key: "retain_mission", choice: { mode: "value", value: originalValue } },
        { key: "reflect_mission", choice: { mode: "suppress" } }],
      labels: [{ key: "taki-layer", choice: { mode: "suppress" } }] };
    const local = await apply(f, bankParams(character.identity.target.bank_id, "taki-bank-v2", choices));
    expect(local.banks).toHaveLength(1);
    expect(readAppliedTemplateSelection(f.db, global.identity)).toEqual(originalGlobal);
    expect(readTemplateDefaults(f.db, initial.guard.providerLineage)).toEqual(defaults);
    expect(readTemplateUser(f.db, character.identity)).toEqual({ ...choices, revision: 1 });
    const update = f.params();
    if (update.target.kind !== "defaults") throw new Error("expected defaults");
    await apply(f, update);
    const selected = readAppliedTemplateSelection(f.db, character.identity)!;
    expect(selected).toMatchObject({ templateRevision: TAKI_MANAGED_TEMPLATE_REVISION, userRevision: 1 });
    expect(selected.projection.config.find((entry) => entry.key === "retain_mission")?.stored).toEqual({ kind: "value", value: originalValue });
    expect(selected.projection.config.find((entry) => entry.key === "reflect_mission")?.stored).toEqual({ kind: "value", value: "" });
    expect(selected.projection.config.find((entry) => entry.key === "entity_labels")?.stored).toEqual({ kind: "value", value: [] });
    expect(readAppliedTemplateSelection(f.db, global.identity)!.projection.config.find((entry) => entry.key === "retain_mission")?.stored)
      .toEqual({ kind: "value", value: loadManagedTemplate(TAKI_MANAGED_TEMPLATE_REVISION, "global").config.retain_mission });
    expect(readTemplateUser(f.db, character.identity)).toEqual({ ...choices, revision: 1 });
    await apply(f, bankParams(character.identity.target.bank_id, TAKI_MANAGED_TEMPLATE_REVISION, emptyChoices()));
    const reset = readAppliedTemplateSelection(f.db, character.identity)!;
    expect(reset.userRevision).toBe(2);
    expect(reset.projection.config.find((entry) => entry.key === "retain_mission")?.stored)
      .toEqual({ kind: "value", value: loadManagedTemplate(TAKI_MANAGED_TEMPLATE_REVISION, "character").config.retain_mission });
    expect(reset.projection.config.find((entry) => entry.key === "entity_labels")?.stored).toMatchObject({ kind: "value", value: [{ key: "taki-layer" }] });
    expect(readTemplateDefaults(f.db, initial.guard.providerLineage)?.revision).toBe(2);
  }, 20_000);

  it("removes Taki while preserving complete user resources, labels and authority until an explicit user reset", async () => {
    const f = fixture(); const initial = await apply(f); const authority = readMemoryAuthoritySelection(f.db);
    const character = initial.banks.find((bank) => bank.identity.scope === "character")!;
    const global = initial.banks.find((bank) => bank.identity.scope === "global")!;
    const installed = readAppliedTemplateSelection(f.db, character.identity)!;
    const model = customModel(installed.snapshot.models[0]!.id);
    const directive = { ...installed.snapshot.directives[0]!.definition!, content: "Complete operator-owned directive",
      is_active: false, priority: -10, tags: [] };
    const choices: MemoryTemplateUserChoices = { ...emptyChoices(),
      config: [{ key: "retain_mission", choice: { mode: "value", value: "My explicit instruction" } }],
      labels: [{ key: "taki-layer", choice: { mode: "suppress" } }, { key: "my-label", choice: { mode: "value", value: { key: "my-label", type: "text" } } }],
      models: [{ id: model.id, choice: { mode: "value", value: model } }],
      directives: [{ id: directive.id, name: directive.name, choice: { mode: "value", value: directive } }] };
    await apply(f, bankParams(character.identity.target.bank_id, TAKI_MANAGED_TEMPLATE_REVISION, choices));
    const remove = f.params();
    if (remove.target.kind !== "defaults") throw new Error("expected defaults");
    remove.target.globalTemplateRevision = "none"; remove.target.characterTemplateRevision = "none";
    const removedPlan = await apply(f, remove);
    const selected = readAppliedTemplateSelection(f.db, character.identity)!;
    expect(selected.templateRevision).toBe("none");
    expect(selected.projection.models.find((entry) => entry.id === model.id)?.definition).toEqual(model);
    expect(selected.projection.directives.find((entry) => entry.id === directive.id)?.definition).toEqual(directive);
    expect(selected.projection.config.find((entry) => entry.key === "retain_mission")?.stored).toEqual({ kind: "value", value: "My explicit instruction" });
    expect(selected.projection.config.find((entry) => entry.key === "entity_labels")?.stored).toEqual({ kind: "value", value: [{ key: "my-label", type: "text" }] });
    expect(removedPlan.banks.find((bank) => bank.identity.scope === "character")!.preview.consequences.deletions)
      .not.toContainEqual(expect.objectContaining({ id: model.id }));
    expect(readAppliedTemplateSelection(f.db, global.identity)!.projection.config.every((entry) => entry.stored.kind === "absent")).toBe(true);
    expect(readMemoryAuthoritySelection(f.db)).toEqual(authority);
    expect(f.service.status().defaults).toMatchObject({ globalTemplateRevision: "none", characterTemplateRevision: "none" });
    await apply(f, bankParams(character.identity.target.bank_id, "none", emptyChoices()));
    const reset = readAppliedTemplateSelection(f.db, character.identity)!;
    expect(reset.projection.config.every((entry) => entry.stored.kind === "absent")).toBe(true);
    expect(reset.projection.models.every((entry) => entry.definition === null)).toBe(true);
    expect(reset.projection.directives.every((entry) => entry.definition === null)).toBe(true);
    expect(readMemoryAuthoritySelection(f.db)).toEqual(authority);
  }, 20_000);
});
