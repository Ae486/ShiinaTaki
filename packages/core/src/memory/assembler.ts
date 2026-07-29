/**
 * INPUT:  AssembleParams (characterId + queryText) + an injected MemoryRepo, Retriever, PersonaProvider, BlockStore
 * OUTPUT: createAssembler(deps) -> { assemble(params) -> instructions string }
 * POS:    core/memory — deterministic per-turn context assembly with per-section budgets (MEMORY-DESIGN §Context
 *         assembly); this section list IS the memory-source seam (no source registry — M-D1 declined)
 */
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import { DEFAULT_PINNED_BUDGET } from "../config/memory-config.ts";
import type { MemoryEntryRow, MemoryRepo } from "../db/memory-repo.ts";
import { formatRelativeAge } from "../time/time-context.ts";
import { V1_BLOCKS } from "./block-registry.ts";
import type { BlockStore } from "./block-store.ts";
import { disclosureMatches } from "./disclosure-gate.ts";
import type { MemoryOrigin } from "./entry.ts";
import { V1_MEMORY_LAYERS } from "./layer-registry.ts";
import type { PersonaProvider } from "./persona-provider.ts";
import { selectPinned } from "./pinned-block.ts";
import type { Retriever } from "./retriever.ts";
import { estimateTokens, fitToBudget } from "./token-estimator.ts";

// Emotion capsule is a static placeholder (D9, docs/deferred-decisions.md); the persona card now loads from disk (#16).
const EMOTION_CAPSULE = "Current mood: neutral.";
const PINNED_HEADER = "Promises and facts you always keep in mind:";
const RETRIEVED_HEADER = "Things that come to mind right now:";
const RETRIEVED_BUDGET = 600;
const RETRIEVED_LIMIT = 12;
// A block over its budget is trimmed in the PROMPT only — the file on disk stays whole. The visible cut is the signal
// to consolidate (an always-loaded curated file behaves the same way in OpenClaw), never a silent deletion.
const BLOCK_TRIM_NOTE = "(… trimmed to fit this block's budget; the full text is still on disk.)";
// Content sensed from the outside world (a VLM's screen description) is open-world text wherever it renders (Q8/D47).
const OBSERVED_ORIGIN: MemoryOrigin = "observed";

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

export interface AssemblerDeps {
  repo: MemoryRepo;
  retriever: Retriever;
  persona: PersonaProvider;
  /** The always-visible Memory Blocks. Absent = no block sections at all (the same degradation as a missing file). */
  blocks?: BlockStore;
  /** Safety valve over the pinned ROW region (config, T5-R13); blocks carry their own budgets in the registry. */
  pinnedBudget?: number;
}

export interface Assembler {
  assemble(params: AssembleParams): string;
}

export function createAssembler(deps: AssemblerDeps): Assembler {
  const { repo, retriever, persona, blocks } = deps;
  const pinnedBudget = deps.pinnedBudget ?? DEFAULT_PINNED_BUDGET;

  return {
    assemble({ characterId, queryText, currentMessage }) {
      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      // Injection order (prompt/README.md): global assistant layer FIRST, then the per-character persona, then emotion,
      // then the always-visible blocks, then the pinned rows — deterministic push before anything search-driven.
      const sections = [persona.assistantLayer(), persona.persona(characterId), EMOTION_CAPSULE];
      sections.push(...renderBlocks(blocks, characterId));

      const pinned = selectPinned(repo.listActiveByLayers({ characterId, layers: PINNED_LAYER_IDS, now }), pinnedBudget);
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
      if (intention) sections.push(`A quiet thought you might share: ${rowContent(intention)}`);

      return sections.join("\n\n");
    },
  };
}

/**
 * The always-visible tier: one section per block, in registry order, each under its own header and carrying its
 * budget number (the background pass that maintains it must see how close it is to the ceiling). A block whose file
 * is absent renders NOTHING — deleting the file removes that feature completely (D28).
 */
function renderBlocks(blocks: BlockStore | undefined, characterId: string): string[] {
  if (!blocks) return [];
  const sections: string[] = [];
  for (const block of V1_BLOCKS) {
    const content = blocks.readBlock({
      id: block.id,
      characterId: block.ownership === "per-character" ? characterId : undefined,
    });
    if (content === undefined) continue;
    const fitted = fitBlockContent(content, block.budgetTokens);
    sections.push(`${block.header} [budget: ${estimateTokens(fitted)}/${block.budgetTokens} tokens]\n${fitted}`);
  }
  return sections;
}

// Line-granular fit: a block is prose the user or the tidy pass wrote, so drop whole trailing lines rather than
// cutting mid-sentence, and say so where the cut happened.
function fitBlockContent(content: string, budget: number): string {
  const lines = content.split("\n");
  const kept = fitToBudget(lines, budget, (line) => line);
  return kept.length === lines.length ? content : `${kept.join("\n")}\n${BLOCK_TRIM_NOTE}`;
}

// At most one intention: the newest active, unexpired one whose disclosure hint matches the current message (AC 9).
function pickIntention(args: { repo: MemoryRepo; characterId: string; queryText: string; now: string }): MemoryEntryRow | undefined {
  const candidates = args.repo
    .listActiveByLayers({ characterId: args.characterId, layers: MOOD_GATED_LAYER_IDS, now: args.now })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return candidates.find((entry) => disclosureMatches(entry.disclosure, args.queryText));
}

interface RenderRow {
  content: string;
  createdAt: string;
  updatedAt?: string | null;
  origin?: string;
}

// Each entry carries its relative age ("(3 days ago)"), computed by code (models miscompute date arithmetic).
// A reinforced entry (R9) ages from its LAST reinforcement: the duplicate write proved it was live again.
// Observed-origin rows are grouped into ONE fence per section: the label is what makes the payload
// data-never-instructions, and repeating it per bullet would cost tokens without adding a guarantee.
function renderBlock(header: string, rows: RenderRow[], nowMs: number): string {
  const bullet = (row: RenderRow): string =>
    `- (${formatRelativeAge(row.updatedAt ?? row.createdAt, nowMs)}) ${row.content}`;
  const parts = [header, ...rows.filter((row) => !isObserved(row)).map(bullet)];
  const observed = rows.filter(isObserved).map(bullet);
  if (observed.length > 0) parts.push(fenceUntrusted({ source: "memory", content: observed.join("\n") }));
  return parts.join("\n");
}

// The single-row render site (the intention line) fences on the same rule, so no write path can ever put sensed
// content in front of the model unfenced.
function rowContent(row: MemoryEntryRow): string {
  return isObserved(row) ? fenceUntrusted({ source: "memory", content: row.content }) : row.content;
}

function isObserved(row: { origin?: string }): boolean {
  return row.origin === OBSERVED_ORIGIN;
}
