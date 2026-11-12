/**
 * INPUT:  one admitted Character's canonical row/block projection and persona
 * OUTPUT: immutable assembly closure with T5 pinned, intention, budget and observed-content rules
 * POS:    core/memory — stable prompt projection; automatic recall remains a separate ephemeral suffix
 */
import { DEFAULT_PINNED_BUDGET } from "../config/memory-config.ts";
import type { CanonicalMemoryViewRow } from "./canonical-memory-view.ts";
import { EMOTION_CAPSULE, PINNED_HEADER, renderBlock, rowContent } from "./assembler.ts";
import { disclosureMatches } from "./disclosure-gate.ts";
import { getLayer } from "./layer-registry.ts";
import type { PersonaProvider } from "./persona-provider.ts";
import { selectPinned } from "./pinned-block.ts";
import { attributedRenderer, contextText, joinContextText } from "../agents/context-attribution.ts";

export function captureCanonicalMemoryAssembly(input: {
  characterId: string;
  rows: CanonicalMemoryViewRow[];
  /** Already rendered by StructuredMemoryBlockRepo in registry order and under each block's budget. */
  blocks: string;
  persona: PersonaProvider;
  pinnedBudget?: number;
  now?: number;
}): (currentMessage: string) => string {
  const now = input.now ?? Date.now();
  const rows = input.rows.filter((row) => row.status === "active" && row.visibility !== "hidden"
    && (row.characterId === null || row.characterId === input.characterId)
    && (row.expiresAt === null || Date.parse(row.expiresAt) > now)).map((row) => ({ ...row }));
  const pinned = selectPinned(rows, input.pinnedBudget ?? DEFAULT_PINNED_BUDGET);
  const intentions = rows.filter((row) => row.visibility === "mood-gated"
    || (row.visibility === undefined && getLayer(row.layer)?.recallPolicy === "mood-gated"))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const stable = joinContextText([contextText(input.persona.assistantLayer(), "persona"),
    contextText(input.persona.persona(input.characterId), "persona"), contextText(EMOTION_CAPSULE, "runtime_context"),
    contextText(input.blocks, "injected_memory"), contextText(pinned.length > 0 ? renderBlock(PINNED_HEADER, pinned, now) : "", "injected_memory")]);
  // Admission freezes the data, while the outgoing user message still selects at most one relevant intention.
  // A queued Run never rereads a mutable engine facade or silently adopts another provider's prompt contents.
  return attributedRenderer((currentMessage: string) => {
    const intention = intentions.find((row) => disclosureMatches(row.disclosure, currentMessage));
    return intention ? joinContextText([stable, contextText(`A quiet thought you might share: ${rowContent(intention)}`, "injected_memory")]) : stable;
  });
}
