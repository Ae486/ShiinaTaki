/**
 * INPUT:  shared memory voice convention and private maintenance responsibilities
 * OUTPUT: tidy instructions and report framing
 * POS:    core/memory — model-facing maintenance contract, separate from execution and persistence
 */
import { MEMORY_VOICE_RULE } from "./write-convention.ts";
import { FINISH_TOOL_NAME } from "./tidy-tools.ts";

/**
 * The six refinement principles, clean-room from Letta's voice-sleeptime prompt (rc A4) — the best single source of
 * adaptable wording for "rewrite memory well".
 */
const REFINEMENT_PRINCIPLES = [
  "- Integrate: merge new facts into what you already hold instead of piling up fragments.",
  "- Update: remove or correct outdated or contradictory information — never leave two conflicting versions live.",
  "- Organize: group related information logically (preferences, background, ongoing goals, interaction styles).",
  "- Infer sensibly: light, well-supported inferences are welcome, but do not invent unsupported details.",
  "- Be precise: absolute dates and times only, never relative words.",
  "- Be comprehensive and concise: aim for high recall and readability.",
].join("\n");

// Tool-granularity doctrine (rc A5 docstring discipline) — the cheapest defence against a runaway whole-block rewrite.
const GRANULARITY_RULE =
  "Use the precise row tools (memory_reinforce / memory_archive_supersede / memory_set_disclosure / memory_refile) " +
  "for narrow edits to single memories. Use block_rethink only for sweeping changes to a whole block — never for a " +
  "small fix.";

// The two standing block duties: R14 (index = recall triggers, never bulk content) + M-D4 (user-model = patterns and
// well-supported inferences; the Identity Card wins every conflict — R7; recurring feedback consolidates into a rule).
const BLOCK_DUTIES =
  "Two blocks are yours to keep current with block_rethink:\n" +
  "- memory-index: a compact per-layer index of what your memory HOLDS — recall triggers worded the way the question " +
  "would be asked ('用户问自己叫什么'), never the memories themselves. Do not index what is already always visible.\n" +
  "- user-model: your consolidated understanding of the user — patterns you have noticed and well-supported " +
  "inferences, dated absolutely. The user's own card wins every conflict, so never restate or contradict it. When " +
  "the same kind of feedback keeps recurring, consolidate it into one standing rule here.";

// Batch-2 F6: the chat prompt trims an over-budget block and its rendered used number can still sit over the limit.
const BUDGET_EXPECTATION =
  "A block's size may read over its budget — over-budget blocks are trimmed in the live prompt, not broken. Treat " +
  "the numbers as a signal to consolidate, not an emergency.";

// The do-nothing permission (rc A4, verbatim in spirit) — the R15 write gate's maintenance twin.
const FINISH_RULE =
  `If there are no meaningful updates to make, call ${FINISH_TOOL_NAME} immediately. Not every observation warrants ` +
  `an edit — be selective, but also aim for high recall. When your edits are done, call ${FINISH_TOOL_NAME}.`;

const BATCH_EFFICIENCY_RULE =
  "Review the whole visible batch before planning changes. Group independent row edits into one response; the tools " +
  "will execute sequentially. Reuse returned references for later edits. A correct, unchanged memory needs no write; " +
  "do not reinforce every row just to show it was reviewed. Consolidate useful changes to each block into one rewrite " +
  "after reviewing the batch, preserving existing information outside this batch. Do not rewrite blocks merely because " +
  "a new batch started. Once tool results confirm the edits, finish promptly without repeated narration or rechecking.";

export const TIDY_SYSTEM_PROMPT = [
  "You run in the background, organizing and maintaining your own long-term memory between conversations. Your goal " +
    "is a store that is comprehensive, readable, and up to date.",
  REFINEMENT_PRINCIPLES,
  MEMORY_VOICE_RULE,
  GRANULARITY_RULE,
  BLOCK_DUTIES,
  BUDGET_EXPECTATION,
  FINISH_RULE,
  BATCH_EFFICIENCY_RULE,
].join("\n\n");

// rc A2: the input arrives as a role:user message wrapped in a system-reminder — she is NOT the primary agent, no
// user is present, and machine self-narration is already forbidden by the base prompt, so: tool calls only.
export const TIDY_INPUT_FRAMING =
  "You are reviewing your own memory store after the conversations already happened — you are NOT the primary " +
  "agent, and no user is present. The report below was computed mechanically from the store: its facts are facts, " +
  "but every flagged candidate is a question for your judgment, never a verdict. Produce no user-visible text — " +
  `respond only with tool calls, and end by calling ${FINISH_TOOL_NAME}.`;
