import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createFallbackPersonaProvider, createPersonaProvider } from "./persona-provider.ts";

const dirs: string[] = [];
function promptDirWith(files: { assistant?: string; personas?: Record<string, string> }): string {
  const root = mkdtempSync(join(tmpdir(), "taki-prompt-"));
  dirs.push(root);
  if (files.assistant !== undefined) {
    mkdirSync(join(root, "system"), { recursive: true });
    writeFileSync(join(root, "system", "assistant-layer.md"), files.assistant, "utf8");
  }
  for (const [id, body] of Object.entries(files.personas ?? {})) {
    mkdirSync(join(root, "characters", id), { recursive: true });
    writeFileSync(join(root, "characters", id, "persona.md"), body, "utf8");
  }
  return root;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmTempDir(dir);
});

describe("createPersonaProvider", () => {
  it("reads the assistant layer and the per-character persona from disk", () => {
    const dir = promptDirWith({
      assistant: "You are a capable companion.",
      personas: { taki: "You are 椎名立希." },
    });
    const provider = createPersonaProvider({ promptDir: dir });
    expect(provider.assistantLayer()).toBe("You are a capable companion.");
    expect(provider.persona("taki")).toBe("You are 椎名立希.");
  });

  it("keys the persona on characterId (invariant 7 — not a hardcoded single character)", () => {
    const dir = promptDirWith({ assistant: "layer", personas: { taki: "TAKI", other: "OTHER" } });
    const provider = createPersonaProvider({ promptDir: dir });
    expect(provider.persona("taki")).toBe("TAKI");
    expect(provider.persona("other")).toBe("OTHER");
  });

  it("strips the leading `>` editorial note block but keeps the title and content", () => {
    const card = "# Persona Card\n\n> editor note line 1\n>\n> editor note line 2\n\n## Who you are\n\nbody text";
    const dir = promptDirWith({ assistant: "a", personas: { taki: card } });
    const persona = createPersonaProvider({ promptDir: dir }).persona("taki");
    expect(persona).not.toContain("editor note");
    expect(persona.startsWith("# Persona Card")).toBe(true);
    expect(persona).toContain("## Who you are");
    expect(persona).toContain("body text");
    expect(persona).not.toContain(">");
  });

  it("falls back for a character whose persona file is missing (never throws)", () => {
    const dir = promptDirWith({ assistant: "layer", personas: { taki: "TAKI" } });
    const provider = createPersonaProvider({ promptDir: dir });
    const unknown = provider.persona("nobody");
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown).not.toBe("TAKI");
  });

  it("degrades to fallbacks when the whole prompt dir is missing (never throws)", () => {
    const provider = createPersonaProvider({ promptDir: join(tmpdir(), "taki-does-not-exist-xyz") });
    expect(provider.assistantLayer().length).toBeGreaterThan(0);
    expect(provider.persona("taki").length).toBeGreaterThan(0);
  });
});

describe("createFallbackPersonaProvider", () => {
  it("returns non-empty fallback cards without touching disk", () => {
    const provider = createFallbackPersonaProvider();
    expect(provider.assistantLayer().length).toBeGreaterThan(0);
    expect(provider.persona("taki").length).toBeGreaterThan(0);
  });
});
