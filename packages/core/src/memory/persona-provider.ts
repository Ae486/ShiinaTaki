/**
 * INPUT:  a promptDir (from ServerConfig) + optional logger; reads system/assistant-layer.md + characters/<id>/persona.md
 * OUTPUT: createPersonaProvider({promptDir, logger?}) + createFallbackPersonaProvider() -> { assistantLayer, persona }
 * POS:    core/memory — the persona-card source injected into the assembler (invariant 8 OS-neutral paths); never throws in a turn
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../logging/logger.ts";

export interface PersonaProvider {
  /** The global assistant-capability layer, injected FIRST; loaded once at construction. */
  assistantLayer(): string;
  /** The per-character persona card, injected AFTER the assistant layer; loaded on first use then cached; safe fallback if missing. */
  persona(characterId: string): string;
}

// Built-in fallbacks so a missing/misconfigured prompt dir degrades instead of throwing inside a turn (assemble is
// sync + per-turn hot path). Deliberately minimal — the shipped cards under prompt/ carry the real content.
const ASSISTANT_LAYER_FALLBACK =
  "You are the user's capable desktop companion. Your tools are part of who you are; when asked for real help, help genuinely — in character.";
const PERSONA_FALLBACK = "You are the user's companion.";

export function createPersonaProvider(deps: { promptDir: string; logger?: Logger }): PersonaProvider {
  const log = deps.logger?.child({ mod: "persona" });
  // The assistant layer is global (one file, every character shares it) — read once at boot; a turn never touches disk.
  const assistantLayer = readCard(join(deps.promptDir, "system", "assistant-layer.md"), ASSISTANT_LAYER_FALLBACK, log);
  // Persona cards are loaded on first use for a character and cached (files don't change until a restart / soul-swap);
  // the readFileSync is sync so it never breaks the assembler's sync contract, and it happens at most once per character.
  const personaCache = new Map<string, string>();

  return {
    assistantLayer: () => assistantLayer,
    persona(characterId) {
      let card = personaCache.get(characterId);
      if (card === undefined) {
        card = readCard(join(deps.promptDir, "characters", characterId, "persona.md"), PERSONA_FALLBACK, log);
        personaCache.set(characterId, card);
      }
      return card;
    },
  };
}

/** The fallback-only provider (no prompt dir): used by tests + as the memory engine's default when none is injected. */
export function createFallbackPersonaProvider(): PersonaProvider {
  return {
    assistantLayer: () => ASSISTANT_LAYER_FALLBACK,
    persona: () => PERSONA_FALLBACK,
  };
}

// A missing/unreadable card degrades to a built-in fallback (never throws in the per-turn hot path). The card's
// leading `>` blockquote is an editorial note to human editors (D22), not persona content, so it is stripped on load.
function readCard(path: string, fallback: string, log?: Logger): string {
  try {
    return stripNoteBlock(readFileSync(path, "utf8"));
  } catch (error) {
    log?.warn({ path, err: error instanceof Error ? error.message : String(error) }, "persona card missing; using fallback");
    return fallback;
  }
}

// Removes only the FIRST contiguous run of markdown blockquote (`>`) lines plus the blank separator it leaves;
// content below (and the title above) is untouched, and any accidental triple blank is collapsed.
function stripNoteBlock(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const isQuote = (line: string | undefined): boolean => line !== undefined && line.trimStart().startsWith(">");
  const start = lines.findIndex((line) => isQuote(line));
  if (start === -1) return markdown.trim();
  let end = start;
  while (isQuote(lines[end])) end += 1;
  if (lines[end]?.trim() === "") end += 1; // consume the blank line the note block leaves behind
  lines.splice(start, end - start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
