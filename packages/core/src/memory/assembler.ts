/**
 * INPUT:  AssembleParams (characterId + queryText) + an injected MemoryRepo and Retriever
 * OUTPUT: createAssembler({repo, retriever}) -> { assemble(params) -> instructions string }
 * POS:    core/memory — deterministic per-turn context assembly with per-section budgets (MEMORY-DESIGN §Context assembly)
 */
import type { MemoryEntryRow, MemoryRepo } from "../db/memory-repo.ts";
import { disclosureMatches } from "./disclosure-gate.ts";
import { V1_MEMORY_LAYERS } from "./layer-registry.ts";
import { selectPinned } from "./pinned-block.ts";
import type { Retriever } from "./retriever.ts";
import { fitToBudget } from "./token-estimator.ts";

// Placeholders (replaced later): persona card = #16, emotion capsule = D2. Static so v1 output is deterministic.
const PERSONA_PLACEHOLDER = "You are the user's companion. (Persona card pending — #16.)";
const EMOTION_CAPSULE = "Current mood: neutral.";
const PINNED_HEADER = "Promises and facts you always keep in mind:";
const RETRIEVED_HEADER = "Things that come to mind right now:";
const PINNED_BUDGET = 800;
const RETRIEVED_BUDGET = 600;
const RETRIEVED_LIMIT = 12;

// Registry-derived layer sets — reading policy fields, never hardcoding ids (invariant 7).
const PINNED_LAYER_IDS = V1_MEMORY_LAYERS.filter(
  (layer) => layer.recallPolicy === "pinned" || layer.pinnedImportanceThreshold !== undefined,
).map((layer) => layer.id);
const RETRIEVED_LAYER_IDS = V1_MEMORY_LAYERS.filter((layer) => layer.recallPolicy === "retrieved").map((l) => l.id);
const MOOD_GATED_LAYER_IDS = V1_MEMORY_LAYERS.filter((layer) => layer.recallPolicy === "mood-gated").map((l) => l.id);

export interface AssembleParams {
  characterId: string;
  /** Current message + recent turns — drives the retrieved block. */
  queryText: string;
  /** The current message alone — the intention gate matches ONLY this (AC 9); defaults to queryText. */
  currentMessage?: string;
}

export interface Assembler {
  assemble(params: AssembleParams): string;
}

export function createAssembler(deps: { repo: MemoryRepo; retriever: Retriever }): Assembler {
  const { repo, retriever } = deps;

  return {
    assemble({ characterId, queryText, currentMessage }) {
      const now = new Date().toISOString();
      const sections = [PERSONA_PLACEHOLDER, EMOTION_CAPSULE];

      const pinned = selectPinned(repo.listActiveByLayers({ characterId, layers: PINNED_LAYER_IDS, now }), PINNED_BUDGET);
      if (pinned.length > 0) sections.push(renderBlock(PINNED_HEADER, pinned));

      const pinnedIds = new Set(pinned.map((row) => row.id));
      const candidates = retriever
        .retrieve({ text: queryText, characterId, layers: RETRIEVED_LAYER_IDS, limit: RETRIEVED_LIMIT })
        .filter((entry) => !pinnedIds.has(entry.id));
      const retrieved = fitToBudget(candidates, RETRIEVED_BUDGET, (entry) => entry.content);
      if (retrieved.length > 0) sections.push(renderBlock(RETRIEVED_HEADER, retrieved));

      const intention = pickIntention({ repo, characterId, queryText: currentMessage ?? queryText, now });
      if (intention) sections.push(`A quiet thought you might share: ${intention.content}`);

      return sections.join("\n\n");
    },
  };
}

// At most one intention: the newest active, unexpired one whose disclosure hint matches the current message (AC 9).
function pickIntention(args: { repo: MemoryRepo; characterId: string; queryText: string; now: string }): MemoryEntryRow | undefined {
  const candidates = args.repo
    .listActiveByLayers({ characterId: args.characterId, layers: MOOD_GATED_LAYER_IDS, now: args.now })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return candidates.find((entry) => disclosureMatches(entry.disclosure, args.queryText));
}

function renderBlock(header: string, rows: Array<{ content: string }>): string {
  return `${header}\n${rows.map((row) => `- ${row.content}`).join("\n")}`;
}
