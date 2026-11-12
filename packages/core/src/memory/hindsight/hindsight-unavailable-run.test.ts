import { describe, expect, it } from "vitest";
import { BASE_SYSTEM_PROMPT } from "../../agents/base-prompt.ts";
import { createFallbackPersonaProvider } from "../persona-provider.ts";
import { MEMORY_UNAVAILABLE_SYSTEM_PROMPT, createHindsightUnavailableRun } from "./hindsight-unavailable-run.ts";

const epoch = { epochId: "epoch", providerLineageId: "11111111-1111-4111-8111-111111111111" };

describe("memory-unavailable Hindsight Run", () => {
  it("keeps the admitted identity with no tools, no recall, persona-only assembly and all-false capabilities", () => {
    const persona = createFallbackPersonaProvider();
    const run = createHindsightUnavailableRun({ epoch, characterId: "mika", persona });
    expect(run.snapshot).toMatchObject({ providerId: "hindsight", providerLineageId: epoch.providerLineageId, authorityEpochId: "epoch",
      capabilities: { retain: false, recall: false, reflect: false, edit: false, vectorRetrieval: "unavailable", derivedMemoryRead: false } });
    expect(run.tools).toEqual({}); expect(run.automaticRecall).toBeUndefined();
    expect(Object.isFrozen(run)).toBe(true); expect(Object.isFrozen(run.tools)).toBe(true); expect(Object.isFrozen(run.snapshot)).toBe(true);
    const assembled = run.assemble!("hello");
    expect(assembled).toContain(persona.persona("mika")); expect(assembled).not.toContain("automatic-memory-recall");
  });

  it("drops only the memory floor from the base prompt", () => {
    const run = createHindsightUnavailableRun({ epoch, characterId: "mika", persona: createFallbackPersonaProvider() });
    expect(run.prompt).toBe(MEMORY_UNAVAILABLE_SYSTEM_PROMPT);
    expect(BASE_SYSTEM_PROMPT).toContain("Memory (non-negotiable):");
    expect(MEMORY_UNAVAILABLE_SYSTEM_PROMPT).not.toContain("Memory (non-negotiable):");
    expect(MEMORY_UNAVAILABLE_SYSTEM_PROMPT).not.toContain("memory_search");
    expect(MEMORY_UNAVAILABLE_SYSTEM_PROMPT).toContain("without a matching tool-result supporting that outcome");
    expect(MEMORY_UNAVAILABLE_SYSTEM_PROMPT).toContain("Errors, refusals and unknowns are not success");
    expect(MEMORY_UNAVAILABLE_SYSTEM_PROMPT.length).toBeGreaterThan(BASE_SYSTEM_PROMPT.length / 2);
  });
});
