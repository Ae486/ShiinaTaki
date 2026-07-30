/**
 * INPUT:  process env (TAKI_MEMORY_PINNED_BUDGET, TAKI_MEMORY_BM25_WEIGHTS, TAKI_MEMORY_STOPLIST)
 * OUTPUT: loadMemoryConfig(env) -> { pinnedBudget, bm25Weights, stoplist }; the fail-closed defaults; Bm25Weights
 * POS:    core/config — the memory subsystem's tunable numbers (T5-R13); garbage values are fatal at boot, never
 *         silently defaulted. The panel surfaces for these are #26's
 */
import { z } from "zod";

// The pinned region's content is naturally bounded (promises + high-importance profile), so this number is a SAFETY
// VALVE rather than a target (T5-R13's correction). Blocks carry their own per-block budgets in the block registry.
export const DEFAULT_PINNED_BUDGET = 800;

/**
 * bm25 column weights for `memory_fts(path UNINDEXED, disclosure, content, search_terms)`.
 *
 * Direction is RULED (T5 Q1 superseded by ra §A.1 + Nocturne A3): disclosure and search_terms ABOVE content. The
 * pre-T5 layout put content on top (2.0) because trigram indexing made it the only live column; under `unicode61`
 * that is inverted — a pure-CJK `content` value is ONE token, so the column fires only for space-separated ASCII,
 * which `search_terms` already covers (and covers better: it also catches the glued `今天用VSCode写了` case that
 * `content` misses). Values were derived against the A/B fixture in fts5-search.test.ts: every candidate triple
 * scores 15/15 rank@1 there, so the discriminating case is the T5-R12 inversion — with content on top, a row that
 * merely MENTIONS a word in ASCII prose outranks the row that wrote that word as its recall trigger. 2/1/2 is the
 * smallest change that fixes it: the old top weight moves off `content` onto the two columns that carry recall.
 */
export const DEFAULT_BM25_WEIGHTS = { disclosure: 2, content: 1, searchTerms: 2 } as const;

export const Bm25WeightsSchema = z.object({
  disclosure: z.number().positive(),
  content: z.number().positive(),
  searchTerms: z.number().positive(),
});
export type Bm25Weights = z.infer<typeof Bm25WeightsSchema>;

// Env-var names ARE the schema keys so a fatal boot error names the variable the operator mistyped.
export const MemoryConfigSchema = z
  .object({
    // Coerce + int + positive: "abc"/"0"/"-1"/"3.5" all throw at boot (fail-closed — a garbage budget must never
    // silently drop every pinned memory or lift the cap).
    TAKI_MEMORY_PINNED_BUDGET: z.coerce.number().int().positive().default(DEFAULT_PINNED_BUDGET),
    // CSV "disclosure,content,searchTerms". A wrong arity or a non-number yields undefined fields, which the weight
    // schema rejects — a mistyped ranking knob must fail the boot rather than silently re-rank her whole memory.
    TAKI_MEMORY_BM25_WEIGHTS: z.string().optional().transform(parseWeights).pipe(Bm25WeightsSchema),
    // Explicit on/off only: an unrecognized value is fatal in either direction (the ambient-config discipline).
    TAKI_MEMORY_STOPLIST: z.enum(["on", "off"]).default("on"),
  })
  .transform((env) => ({
    pinnedBudget: env.TAKI_MEMORY_PINNED_BUDGET,
    bm25Weights: env.TAKI_MEMORY_BM25_WEIGHTS,
    stoplist: env.TAKI_MEMORY_STOPLIST === "on",
  }));

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export function loadMemoryConfig(env: Record<string, string | undefined>): MemoryConfig {
  return MemoryConfigSchema.parse({
    TAKI_MEMORY_PINNED_BUDGET: env.TAKI_MEMORY_PINNED_BUDGET,
    TAKI_MEMORY_BM25_WEIGHTS: env.TAKI_MEMORY_BM25_WEIGHTS,
    TAKI_MEMORY_STOPLIST: env.TAKI_MEMORY_STOPLIST,
  });
}

function parseWeights(csv: string | undefined): unknown {
  if (csv === undefined) return DEFAULT_BM25_WEIGHTS;
  const parts = csv.split(",").map((value) => Number(value.trim()));
  if (parts.length !== 3) return {};
  return { disclosure: parts[0], content: parts[1], searchTerms: parts[2] };
}
