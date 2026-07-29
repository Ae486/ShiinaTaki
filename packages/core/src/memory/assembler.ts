/**
 * INPUT:  AssembleParams (characterId + queryText) + an injected MemoryRepo, Retriever, and PersonaProvider
 * OUTPUT: createAssembler({repo, retriever, persona}) -> { assemble(params) -> instructions string }
 * POS:    core/memory — deterministic per-turn context assembly with per-section budgets (MEMORY-DESIGN §Context assembly)
 */
import type { MemoryEntryRow, MemoryRepo } from "../db/memory-repo.ts";
import { formatRelativeAge } from "../time/time-context.ts";
import { disclosureMatches } from "./disclosure-gate.ts";
import { V1_MEMORY_LAYERS } from "./layer-registry.ts";
import type { PersonaProvider } from "./persona-provider.ts";
import { selectPinned } from "./pinned-block.ts";
import type { Retriever } from "./retriever.ts";
import { fitToBudget } from "./token-estimator.ts";

// Emotion capsule is a static placeholder (D9, docs/deferred-decisions.md); the persona card now loads from disk (#16).
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

export function createAssembler(deps: { repo: MemoryRepo; retriever: Retriever; persona: PersonaProvider }): Assembler {
  const { repo, retriever, persona } = deps;

  return {
    assemble({ characterId, queryText, currentMessage }) {
      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      // Injection order (prompt/README.md): global assistant layer FIRST, then the per-character persona, then emotion.
      const sections = [persona.assistantLayer(), persona.persona(characterId), EMOTION_CAPSULE];

      const pinned = selectPinned(repo.listActiveByLayers({ characterId, layers: PINNED_LAYER_IDS, now }), PINNED_BUDGET);
      if (pinned.length > 0) sections.push(renderBlock(PINNED_HEADER, pinned, nowMs));

      const pinnedIds = new Set(pinned.map((row) => row.id));
      const candidates = retriever
        .retrieve({ text: queryText, characterId, layers: RETRIEVED_LAYER_IDS, limit: RETRIEVED_LIMIT })
        .filter((entry) => !pinnedIds.has(entry.id));
      const retrieved = fitToBudget(candidates, RETRIEVED_BUDGET, (entry) => entry.content);
      // Retrieved rows expose `created`; normalize to the `createdAt` renderBlock reads (pinned rows carry it directly).
      if (retrieved.length > 0)
        sections.push(renderBlock(RETRIEVED_HEADER, retrieved.map((e) => ({ content: e.content, createdAt: e.created })), nowMs));

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

// Each entry carries its relative age ("(3 days ago)"), computed by code (models miscompute date arithmetic).
// A reinforced entry (R9) ages from its LAST reinforcement: the duplicate write proved it was live again.
function renderBlock(header: string, rows: Array<{ content: string; createdAt: string; updatedAt?: string | null }>, nowMs: number): string {
  return `${header}\n${rows
    .map((row) => `- (${formatRelativeAge(row.updatedAt ?? row.createdAt, nowMs)}) ${row.content}`)
    .join("\n")}`;
}
