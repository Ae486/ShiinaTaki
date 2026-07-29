/**
 * INPUT:  n/a (declarative data) — validated at module load
 * OUTPUT: BlockDefinitionSchema + V1_BLOCKS (array order = injection order) + getBlock selector
 * POS:    core/memory — the Memory Block taxonomy as DATA (invariant 7, T5 Q7): blocks are pure markdown files,
 *         ALL policy (who writes, where it lives, how much context it may take) lives in these rows
 */
import { z } from "zod";

// Kebab id: it IS the file name (`<id>.md`), so traversal/separators must be unexpressible by construction.
const BlockIdSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "block id must be kebab-case");

export const BlockDefinitionSchema = z
  .object({
    id: BlockIdSchema,
    ownership: z.enum(["global", "per-character"]),
    // Who may write through the store API: a `user` block is hand-edited only — no agent-side path may touch it (R7).
    writer: z.enum(["user", "background"]),
    // One line of prompt framing rendered above the content; tells the model what this block IS and how to weigh it.
    header: z.string().min(1),
    // Context real estate this block may take. Rendered beside the content so the background writer that maintains it
    // can see how close it is to the ceiling (Letta renders chars_current/chars_limit for the same reason).
    budgetTokens: z.int().positive(),
  })
  .strict();
export type BlockDefinition = z.infer<typeof BlockDefinitionSchema>;

/**
 * The v1 blocks (MEMORY-DESIGN §Blocks). ARRAY ORDER IS THE INJECTION ORDER — declarative, with no position
 * numbers to collide or leave gaps: the user's hard facts, then her own reading of the user, then the index as
 * navigation (PRD §3). Adding a block = one row + a file; deleting the file removes it entirely (D28).
 * The two user-facing budgets follow the always-loaded-file precedent (Hermes USER.md ~500 tok / MEMORY.md ~800 tok).
 */
export const V1_BLOCKS: readonly BlockDefinition[] = z.array(BlockDefinitionSchema).parse([
  {
    id: "user-card",
    ownership: "global",
    writer: "user",
    header:
      "What the user has written about themselves. They maintain this themselves, so where it disagrees with " +
      "anything else you remember, this is what is true.",
    budgetTokens: 500,
  },
  {
    id: "user-model",
    ownership: "global",
    writer: "background",
    header:
      "What you have come to understand about the user over time — patterns you noticed, not things they stated " +
      "outright. Where this disagrees with what they wrote about themselves above, they are right.",
    budgetTokens: 800,
  },
  {
    id: "memory-index",
    ownership: "per-character",
    writer: "background",
    header:
      "Topics your memory holds — pointers, not the memories themselves. When one of these comes up, search your " +
      "memory for the details instead of answering from impression.",
    // No external precedent for an index budget: a local first guess, deliberately the smallest of the three because
    // pointers should stay pointers. Revisit once batch 4's tidy pass gives this block real content.
    budgetTokens: 400,
  },
]);

const BLOCKS_BY_ID = new Map(V1_BLOCKS.map((block) => [block.id, block]));

export function getBlock(id: string): BlockDefinition | undefined {
  return BLOCKS_BY_ID.get(id);
}
