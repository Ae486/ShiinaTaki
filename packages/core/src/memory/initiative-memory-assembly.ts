/**
 * INPUT: the owning memory runtime's captured Persona and explicitly scoped bounded Block/index projections
 * OUTPUT: immutable selected initiative instructions with truthful source identities and content revisions
 * POS: core/memory — deterministic assembly only; no recall, pinned-row scan, legacy picker or new authority
 */
import { createHash } from "node:crypto";
import { InitiativeSelectedContextSchema, InitiativeSourceSchema, type InitiativeContextManifest } from "@taki/shared";
import type { PersonaProvider } from "./persona-provider.ts";

export interface InitiativeMemorySelection { global: boolean; character: boolean }
export interface InitiativeMemoryContext { text: string; sources: InitiativeContextManifest["sources"] }
export type InitiativeMemoryAssembler = (selection: InitiativeMemorySelection) => InitiativeMemoryContext;
export interface InitiativeMemoryFragment { reference: string; content: string }

export function captureInitiativeMemoryAssembly(input: {
  characterId: string; persona: PersonaProvider;
  global?: InitiativeMemoryFragment; character?: InitiativeMemoryFragment;
}): InitiativeMemoryAssembler {
  const persona = [input.persona.assistantLayer(), input.persona.persona(input.characterId)].filter(Boolean).join("\n\n");
  const global = input.global ? { ...input.global } : undefined;
  const character = input.character ? { ...input.character } : undefined;
  const personaSource = source("persona", input.characterId, persona);
  return (selection) => {
    const sections = [persona]; const sources = [personaSource];
    for (const [selected, fragment] of [[selection.global, global], [selection.character, character]] as const) {
      if (!selected || !fragment?.content.trim()) continue;
      sections.push(fragment.content); sources.push(source("memory", fragment.reference, fragment.content));
    }
    // Preserve the complete stable Persona and each owning Block renderer's existing budget semantics.
    // An oversized assembled profile refuses; it is never silently reinterpreted by parsing or slicing headings.
    const text = InitiativeSelectedContextSchema.shape.instructions.parse(sections.join("\n\n"));
    return { text, sources: sources.map((entry) => ({ ...entry })) };
  };
}

function source(category: "persona" | "memory", reference: string, content: string): InitiativeContextManifest["sources"][number] {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  return InitiativeSourceSchema.parse({ category, reference: `${category}:${hash(reference)}`, revision: hash(content), trust: "core" });
}

export function bindInitiativeAssembly(assembly: InitiativeMemoryAssembler | undefined, isCurrent: () => boolean): InitiativeMemoryAssembler | undefined {
  if (!assembly) return undefined;
  return (selection) => {
    if (!isCurrent()) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    return assembly(selection);
  };
}

/** Freeze text once; compare only scopes actually selected by the initiative owner during its lifetime. */
export function captureTrackedInitiativeAssembly(capture: () => InitiativeMemoryAssembler) {
  const original = capture(); const selected = new Map<string, InitiativeMemorySelection>();
  const matches = (selection: InitiativeMemorySelection) => {
    const before = original(selection); const current = capture()(selection);
    return before.text === current.text && JSON.stringify(before.sources) === JSON.stringify(current.sources);
  };
  const isCurrent = () => {
    try { return [...selected.values()].every(matches); } catch { return false; }
  };
  const assemble: InitiativeMemoryAssembler = (selection) => {
    if (!isCurrent() || !matches(selection)) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    selected.set(JSON.stringify(selection), { ...selection });
    return original(selection);
  };
  return { assemble, isCurrent };
}
