import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createStructuredMemoryBlockRepo } from "../db/structured-memory-block-repo.ts";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../testing/hindsight-runtime-composition-fixtures.ts";
import { failingGenerateModel } from "../testing/mock-language-model.ts";
import { createBlockStore } from "./block-store.ts";
import { captureInitiativeMemoryAssembly, captureTrackedInitiativeAssembly } from "./initiative-memory-assembly.ts";

const fixtures: HindsightRuntimeFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
type Mode = "local" | "legacy" | "hindsight";
function fixture(mode: Mode) {
  const model = failingGenerateModel(new Error("initiative assembly must not call a model"));
  const f = hindsightRuntimeFixture({ mode, model }); fixtures.push(f);
  mkdirSync(join(f.promptDir, "system"), { recursive: true });
  mkdirSync(join(f.promptDir, "characters", "taki"), { recursive: true });
  writeFileSync(join(f.promptDir, "system", "assistant-layer.md"), "STABLE_ASSISTANT", "utf8");
  writeFileSync(join(f.promptDir, "characters", "taki", "persona.md"), "STABLE_TAKI_PERSONA", "utf8");
  return { f, model };
}
function blocks(f: HindsightRuntimeFixture, mode: Mode, suffix = "ORIGINAL") {
  if (mode === "legacy") {
    const store = createBlockStore({ root: join(f.dataDir, "workspace", "blocks") });
    store.writeBlock({ id: "user-card", caller: "user", content: `GLOBAL_CARD_${suffix}` });
    store.writeBlock({ id: "memory-index", characterId: "taki", caller: "background", content: `TAKI_INDEX_${suffix}` });
    store.writeBlock({ id: "memory-index", characterId: "other", caller: "background", content: "OTHER_CHARACTER_PRIVATE" });
    return;
  }
  const repo = createStructuredMemoryBlockRepo(f.db);
  repo.replace({ blockId: "user-card", scope: { kind: "global", characterId: null }, actor: "user", content: `GLOBAL_CARD_${suffix}` });
  repo.replace({ blockId: "memory-index", scope: { kind: "character", characterId: "taki" }, actor: "background", content: `TAKI_INDEX_${suffix}` });
  repo.replace({ blockId: "memory-index", scope: { kind: "character", characterId: "other" }, actor: "background", content: "OTHER_CHARACTER_PRIVATE" });
}

describe("provider-neutral captured initiative Memory Blocks", () => {
  it.each(["local", "legacy", "hindsight"] as const)("honors all four scope selections under %s while preserving primary assembly", async (mode) => {
    const { f, model } = fixture(mode); blocks(f, mode);
    const runtime = f.compose(); const captured = await runtime.captureRun("taki");
    const primary = captured.assemble!(""); const calls = f.remote.calls.length;
    expect(primary).toContain("GLOBAL_CARD_ORIGINAL"); expect(primary).toContain("TAKI_INDEX_ORIGINAL");
    for (const global of [false, true]) for (const character of [false, true]) {
      const selected = captured.assembleInitiative!({ global, character });
      expect(selected.text).toContain("STABLE_ASSISTANT"); expect(selected.text).toContain("STABLE_TAKI_PERSONA");
      expect(selected.text.includes("GLOBAL_CARD_ORIGINAL")).toBe(global);
      expect(selected.text.includes("TAKI_INDEX_ORIGINAL")).toBe(character);
      expect(selected.text).not.toContain("OTHER_CHARACTER_PRIVATE");
      expect(selected.sources).toHaveLength(1 + Number(global) + Number(character));
      expect(selected.sources[0]!.category).toBe("persona");
      expect(selected.sources.every((source) => /^[a-f0-9]{64}$/.test(source.revision))).toBe(true);
    }
    expect(captured.assemble!("")).toBe(primary);
    expect(f.remote.calls).toHaveLength(calls); expect(model.doGenerateCalls).toHaveLength(0);
    if (mode !== "hindsight") expect(f.remote.calls).toHaveLength(0);
  });

  it.each(["local", "legacy", "hindsight"] as const)("freezes selected %s projections before later Block edits", async (mode) => {
    const { f } = fixture(mode); blocks(f, mode); const runtime = f.compose();
    const first = await runtime.captureRun("taki"); const selected = first.assembleInitiative!({ global: true, character: true });
    blocks(f, mode, "LATER");
    expect(first.isCurrent?.()).toBe(false);
    expect(() => first.assembleInitiative!({ global: true, character: true })).toThrow("MEMORY_AUTHORITY_MISMATCH");
    const next = (await runtime.captureRun("taki")).assembleInitiative!({ global: true, character: true });
    expect(next.text).toContain("GLOBAL_CARD_LATER"); expect(next.text).toContain("TAKI_INDEX_LATER");
    expect(next.sources[0]).toEqual(selected.sources[0]); expect(next.sources[1]!.revision).not.toBe(selected.sources[1]!.revision);
  });

  it.each(["local", "legacy", "hindsight"] as const)("keeps missing %s blocks absent and refuses a retired runtime", async (mode) => {
    const { f } = fixture(mode); const runtime = f.compose(); const captured = await runtime.captureRun("taki");
    const selected = captured.assembleInitiative!({ global: true, character: true });
    expect(selected.text).toBe("STABLE_ASSISTANT\n\nSTABLE_TAKI_PERSONA"); expect(selected.sources).toHaveLength(1);
    await runtime.stop();
    expect(() => captured.assembleInitiative!({ global: false, character: false })).toThrow("MEMORY_AUTHORITY_MISMATCH");
  });

  it.each(["local", "hindsight"] as const)("fences selected %s Blocks while preserving boot-cached Persona semantics", async (mode) => {
    const { f } = fixture(mode); blocks(f, mode); const runtime = f.compose();
    const captured = await runtime.captureRun("taki");
    captured.assembleInitiative!({ global: false, character: true });
    const repo = createStructuredMemoryBlockRepo(f.db);
    repo.replace({ blockId: "user-card", scope: { kind: "global", characterId: null }, actor: "user", content: "UNSELECTED_UPDATE" });
    expect(captured.isCurrent?.()).toBe(true);
    writeFileSync(join(f.promptDir, "characters", "taki", "persona.md"), "CHANGED_PERSONA", "utf8");
    expect(captured.isCurrent?.()).toBe(true);
    repo.replace({ blockId: "memory-index", scope: { kind: "character", characterId: "taki" }, actor: "background", content: "SELECTED_UPDATE" });
    expect(captured.isCurrent?.()).toBe(false);
  });

  it("fences a change to the actual Persona producer without treating a file edit as an effective reload", () => {
    let persona = "Original Persona";
    const captured = captureTrackedInitiativeAssembly(() => captureInitiativeMemoryAssembly({ characterId: "taki",
      persona: { assistantLayer: () => "Assistant", persona: () => persona } }));
    captured.assemble({ global: false, character: false }); expect(captured.isCurrent()).toBe(true);
    persona = "New Persona"; expect(captured.isCurrent()).toBe(false);
  });

  it("rejects Hindsight endpoint drift before returning an old selected projection", async () => {
    const { f } = fixture("hindsight"); blocks(f, "hindsight"); const runtime = f.compose();
    const captured = await runtime.captureRun("taki"); const calls = f.remote.calls.length;
    f.config.upsert("TAKI_HINDSIGHT_ENDPOINT", "http://127.0.0.1:18482");
    expect(() => captured.assembleInitiative!({ global: true, character: true })).toThrow("MEMORY_AUTHORITY_MISMATCH");
    expect(f.remote.calls).toHaveLength(calls);
  });

  it("rejects Local authority drift before returning an old selected projection", async () => {
    const { f } = fixture("local"); const captured = await f.compose().captureRun("taki");
    f.db.exec("UPDATE canonical_memory_authority_epochs SET provider_lineage_id='replacement' WHERE status='active'");
    expect(() => captured.assembleInitiative!({ global: true, character: true })).toThrow("MEMORY_AUTHORITY_MISMATCH");
  });

  it("rejects an oversized Persona instead of silently truncating identity or interpreting headings", () => {
    const assemble = captureInitiativeMemoryAssembly({ characterId: "taki",
      persona: { assistantLayer: () => "assistant", persona: () => "a".repeat(32_001) } });
    expect(() => assemble({ global: false, character: false })).toThrow();
  });
});
