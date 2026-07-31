/**
 * INPUT:  process env (TAKI_MEMORY_PINNED_BUDGET, TAKI_MEMORY_BM25_WEIGHTS, TAKI_MEMORY_STOPLIST,
 *         TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS, TAKI_MEMORY_TIDY_* — write threshold / max steps / stale days /
 *         report cap)
 * OUTPUT: loadMemoryConfig(env) -> { pinnedBudget, bm25Weights, stoplist, intentionsDefaultDays, tidyWriteThreshold,
 *         tidyMaxSteps, tidyStaleDays, reportClassCap }; the fail-closed defaults; Bm25Weights
 * POS:    core/config — the memory subsystem's tunable numbers (T5-R13); garbage values are fatal at boot, never
 *         silently defaulted. The panel surfaces for these are #26's
 */
import { z } from "zod";

// The pinned region's content is naturally bounded (promises + high-importance profile), so this number is a SAFETY
// VALVE rather than a target (T5-R13's correction). Blocks carry their own per-block budgets in the block registry.
export const DEFAULT_PINNED_BUDGET = 800;

// How long an `intentions` entry that carries NO explicit `expires` may sit before retention archives it. A LOCAL
// choice with no external source: nothing sets `expires` today, so without an age fallback the expiring layer would
// never expire anything at all. Raise it if real intentions turn out to outlive a month.
export const DEFAULT_INTENTIONS_DAYS = 30;

// The tidy pass's write-count trigger (T5 Q9). Nocturne's "every 30-50 new memories" cadence was NOT found at source
// (rc §OMITTED), so 40 is a TUNABLE default, not a sourced constant.
export const DEFAULT_TIDY_WRITE_THRESHOLD = 40;

// Step ceiling for one tidy pass — a structural exit alongside the finish tool, deliberately far below Letta's
// DEFAULT_MAX_STEPS = 50 (rc A2): our input is a bounded defect report, not an open transcript.
export const DEFAULT_TIDY_MAX_STEPS = 12;

// Age past which a searchable row becomes a "why was this never recalled?" candidate. A LOCAL choice with no external
// source (Nocturne tiers stale per priority; a flat window is the v1 seam — batch-4 design §5).
export const DEFAULT_TIDY_STALE_DAYS = 45;

// Per-class candidate cap in the tidy report, so a degraded store cannot blow the pass's context. A LOCAL choice
// with no external source; dropped counts are stated in the report itself.
export const DEFAULT_TIDY_REPORT_CAP = 10;

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
    // Same fail-closed parse as the budget: a garbage retention window must not silently archive every intention
    // (or none of them).
    TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS: z.coerce.number().int().positive().default(DEFAULT_INTENTIONS_DAYS),
    // The four tidy numbers share the budget's discipline: coerce + int + positive, garbage fatal at boot. A silently
    // defaulted threshold would change when the maintenance model runs — and what it costs — behind the operator's back.
    TAKI_MEMORY_TIDY_WRITE_THRESHOLD: z.coerce.number().int().positive().default(DEFAULT_TIDY_WRITE_THRESHOLD),
    TAKI_MEMORY_TIDY_MAX_STEPS: z.coerce.number().int().positive().default(DEFAULT_TIDY_MAX_STEPS),
    TAKI_MEMORY_TIDY_STALE_DAYS: z.coerce.number().int().positive().default(DEFAULT_TIDY_STALE_DAYS),
    TAKI_MEMORY_TIDY_REPORT_CAP: z.coerce.number().int().positive().default(DEFAULT_TIDY_REPORT_CAP),
  })
  .transform((env) => ({
    pinnedBudget: env.TAKI_MEMORY_PINNED_BUDGET,
    bm25Weights: env.TAKI_MEMORY_BM25_WEIGHTS,
    stoplist: env.TAKI_MEMORY_STOPLIST === "on",
    intentionsDefaultDays: env.TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS,
    tidyWriteThreshold: env.TAKI_MEMORY_TIDY_WRITE_THRESHOLD,
    tidyMaxSteps: env.TAKI_MEMORY_TIDY_MAX_STEPS,
    tidyStaleDays: env.TAKI_MEMORY_TIDY_STALE_DAYS,
    reportClassCap: env.TAKI_MEMORY_TIDY_REPORT_CAP,
  }));

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export function loadMemoryConfig(env: Record<string, string | undefined>): MemoryConfig {
  return MemoryConfigSchema.parse({
    TAKI_MEMORY_PINNED_BUDGET: env.TAKI_MEMORY_PINNED_BUDGET,
    TAKI_MEMORY_BM25_WEIGHTS: env.TAKI_MEMORY_BM25_WEIGHTS,
    TAKI_MEMORY_STOPLIST: env.TAKI_MEMORY_STOPLIST,
    TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS: env.TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS,
    TAKI_MEMORY_TIDY_WRITE_THRESHOLD: env.TAKI_MEMORY_TIDY_WRITE_THRESHOLD,
    TAKI_MEMORY_TIDY_MAX_STEPS: env.TAKI_MEMORY_TIDY_MAX_STEPS,
    TAKI_MEMORY_TIDY_STALE_DAYS: env.TAKI_MEMORY_TIDY_STALE_DAYS,
    TAKI_MEMORY_TIDY_REPORT_CAP: env.TAKI_MEMORY_TIDY_REPORT_CAP,
  });
}

function parseWeights(csv: string | undefined): unknown {
  if (csv === undefined) return DEFAULT_BM25_WEIGHTS;
  const parts = csv.split(",").map((value) => Number(value.trim()));
  if (parts.length !== 3) return {};
  return { disclosure: parts[0], content: parts[1], searchTerms: parts[2] };
}
