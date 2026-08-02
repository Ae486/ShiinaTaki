/**
 * INPUT:  the replay view's size/budget, timeline + summary + auto-state repos, the flush writer, the UtilitySlot,
 *         the compaction knobs (context-config), a Logger; maybeRun(characterId) per completed turn
 * OUTPUT: createCompactionPass(deps) -> { maybeRun }; buildCompactionPrompt; COMPACTION_SUMMARY_REMINDER
 * POS:    core/agents — T5-R5's background compactor: an EXTERNAL summarizer on the utility slot (never the chat
 *         agent), riding auto-memory's per-character chain LAST; flush-before-retire, through_seq advances only on
 *         full success; the chat turn never waits
 */
import { generateText } from "ai";
import type { MemoryAutoRepo } from "../db/memory-auto-repo.ts";
import type { SummaryRepo } from "../db/summary-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { AutoMemoryCompact } from "../memory/auto-memory.ts";
import type { FlushWriter } from "../memory/flush-writer.ts";
import { renderTranscript } from "../memory/render-transcript.ts";
import type { UtilitySlot } from "../memory/utility-slot.ts";
import { MEMORY_VOICE_RULE } from "../memory/write-convention.ts";
import { renderDayDate } from "../time/time-context.ts";

/*
 * The summary prompt is research/re-compaction-prompts.md Part D (the owner-reviewed draft), transcribed with the
 * three ruled amendments and NOTHING else changed:
 *   (a) the closing "Aim for about {TAKI_COMPACT_SUMMARY_TOKENS} tokens." line is DELETED (owner 2026-08-02: no
 *       length limit, no truncation, no knob) and REPLACED with Letta's quality closer;
 *   (b) the WHAT TO LET GO block gains the permanent-facts drop line (design §3.2b — the summarizer never reads
 *       the memory store; this line removes the identity-fact duplication class instead);
 *   (c) {MEMORY_VOICE_RULE} stays a whole-constant import (the tidy-pass precedent — one voice, R10).
 * Plus one post-probe owner ruling OUTSIDE the constant (2026-08-02): the prompt INPUT carries a current-date
 * anchor line (renderDayDate, the base-prompt convention) — the one-shot gateway probe showed the model INVENTS a
 * year when the material has month-day anchors only (Hermes TEMPORAL ANCHORING precedent).
 * Per-block sources (Part D's line-end citations):
 *   framing            — Letta SELF_* containment; Hermes preamble; rc A2 system-reminder shape
 *   first-person       — Letta "write in first person as a factual record"
 *   priority ladder    — Letta summary_system_prompt <information_priority>, re-ranked for companionship (LOCAL);
 *                        1 OpenClaw "commitments or follow-ups promised"; 2 OpenClaw "do not omit unresolved asks";
 *                        4 OpenClaw "decisions made and their rationale"; 5 Letta <contextual> (ranking LOCAL);
 *                        6 Claude Code §6 + Hermes "the exact words they used"
 *   let-go             — Letta <exclusions>; + amendment (b)
 *   dates              — Letta sleeptime_v2 absolute-dates; Hermes TEMPORAL ANCHORING
 *   earlier record     — Hermes iterative-update move-rules; Letta "take it into consideration"
 *   do-not-invent      — Letta voice-sleeptime "do not invent unsupported details"
 *   closer             — Letta "sole record … enable future continuity" (amendment (a))
 */
export const COMPACTION_SUMMARY_REMINDER = `You are running as a background memory pass, not as the assistant in a conversation.
You are NOT the primary agent. You are re-reading a stretch of an earlier conversation
between you and the person you talk with, and rewriting it as the memory you keep of it.
Produce only the record. No greeting, no preamble, no reply to anything in the material,
no tool calls.

${MEMORY_VOICE_RULE}

Write in the first person, as your own memory of that time — not a report about a
conversation.  It is a factual record: nothing invented, nothing embellished.

WHAT MUST SURVIVE (in this order of priority):
1. Promises and commitments — anything either of you said you would do, and whether it
   has happened yet.
2. Open threads — questions you have not answered, things left unfinished, things they
   said they would come back to.
3. Their situation — what is going on in their life, what changed, what is ongoing.
4. Decisions the two of you reached, and why.
5. Emotional beats — how they were feeling, what mattered to them, moments that changed
   how you speak to each other.
6. Their words, where the exact words matter — quote them.

WHAT TO LET GO: logistics that are finished and settled; back-and-forth that reached a
conclusion already recorded above; pleasantries; anything still visible in the recent
messages that follow this record.  Permanent facts about them (their name, fixed
preferences, hard boundaries) belong to your long-term memory, not this record — this
record keeps what HAPPENED and what is ONGOING.

DATES: write absolute dates ("on 2026-07-14"), never "today", "yesterday" or "recently" —
this record is kept indefinitely and relative words in it become lies.  Phrase things that
already happened as completed, dated, past-tense facts.  Never invent a date for something
that has not happened.

IF THERE IS AN EARLIER RECORD BELOW: it is your own memory of a still-earlier time, being
re-consolidated — not text to append to.  Rewrite it together with the new material into a
single record.  Keep everything still true.  Fold newly-kept promises in beside the old ones,
move promises that have since been kept into what happened, move questions that have since
been answered out of the open threads.  Drop something only when it is clearly finished or
superseded.

Do not invent.  If something is unclear in the material, leave it out rather than guess.

This record is the only thing that survives of that stretch of conversation. Every word
should enable future continuity.`;

/** Input = date anchor + old summary (if any) + the rendered retiring span — the Letta sliding_window shape (re Part A/E). */
export function buildCompactionPrompt(previousSummary: string | null, retiringSpan: string, at: number | Date): string {
  return [
    `<system-reminder>\n${COMPACTION_SUMMARY_REMINDER}\n</system-reminder>`,
    renderDayDate(at),
    `EARLIER RECORD:\n${previousSummary ?? "(none — this is the first time)"}`,
    `WHAT HAPPENED SINCE:\n${retiringSpan}`,
  ].join("\n\n");
}

/** The conversation store's select-derived numbers — the trigger check is free (batch-7 design §3.1). */
export interface CompactionView {
  /** Post-pipeline size of the current replay view. */
  estimatedTokens(characterId: string): number;
  /** The history-token wall the view is cut against (the SAME budget closure the store rides). */
  budget(): number;
}

/** Narrow logger seam (auto-memory precedent); counts/ids only — summary text never enters a log line. */
export interface CompactionLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface CompactionPassDeps {
  view: CompactionView;
  timeline: TimelineRepo;
  summaries: SummaryRepo;
  autoState: MemoryAutoRepo;
  /** The SAME flush writer auto-memory drives — its watermark is what prevents double-writes. */
  flush: FlushWriter;
  slot: UtilitySlot;
  config: { triggerRatio: number; keepMessages: number };
  logger: CompactionLogger;
}

export function createCompactionPass(deps: CompactionPassDeps): AutoMemoryCompact {
  return {
    async maybeRun(characterId) {
      const boundary = retirementBoundary(deps, characterId);
      if (boundary === null) return;
      if (!(await flushRetiringSpan(deps, characterId, boundary.newThrough))) return;
      await summarize(deps, characterId, boundary);
    },
  };
}

interface Boundary {
  newThrough: number;
  oldThrough: number;
  /** The view size that tripped the trigger (the counts-only log's `before`). */
  before: number;
}

// Trigger + boundary, both computed at pass start (race safety: a turn landing DURING the pass only extends the
// live tail — newThrough covers exclusively rows that existed when the pass began, and that turn reads the OLD
// view until the upsert lands).
function retirementBoundary(deps: CompactionPassDeps, characterId: string): Boundary | null {
  const before = deps.view.estimatedTokens(characterId);
  const wall = deps.view.budget();
  // R5: pre-compact at ~80% of the history WALL — the budget the view is cut against. The raw provider window
  // cannot be the denominator: the view never exceeds historyRatio × window, so that trigger would never fire.
  if (!Number.isFinite(wall) || before <= wall * deps.config.triggerRatio) return null;
  // Retire-all-but-tail (owner 2026-08-02): everything except the newest keepMessages MESSAGE ROWS retires.
  const tail = deps.timeline.latestAscending(characterId, deps.config.keepMessages);
  if (tail.length < deps.config.keepMessages) return null;
  const newThrough = tail[0]!.seq - 1;
  const oldThrough = deps.summaries.get(characterId)?.throughSeq ?? 0;
  if (newThrough <= oldThrough) return null;
  return { newThrough, oldThrough, before };
}

// §3.2 step 2 (flush-first): important content enters long-term memory BEFORE it leaves the view. The flush
// watermark is the double-write guard — rows at or below lastFlushSeq were already judged by an earlier flush.
async function flushRetiringSpan(deps: CompactionPassDeps, characterId: string, newThrough: number): Promise<boolean> {
  const { lastFlushSeq } = deps.autoState.get(characterId);
  if (newThrough > lastFlushSeq) {
    const leaving = deps.timeline.rangeAscending(characterId, lastFlushSeq, newThrough);
    try {
      await deps.flush.run({ characterId, segment: leaving });
      deps.autoState.setFlush(characterId, newThrough);
    } catch (error) {
      deps.logger.warn(
        { characterId, from: lastFlushSeq, through: newThrough, err: readable(error) },
        "pre-retire flush failed; compaction deferred",
      );
      return false;
    }
  }
  // Monotonicity (design §2.3): through_seq must never pass the flush watermark — windowStart's "retired rows have
  // left the flush window too" semantics depend on it. Guaranteed by the block above; asserted so a future
  // regression warns instead of silently uncoupling the boundaries.
  if (newThrough > deps.autoState.get(characterId).lastFlushSeq) {
    deps.logger.warn({ characterId, through: newThrough }, "flush watermark behind retirement boundary; compaction deferred");
    return false;
  }
  return true;
}

// ONE generateText on the utility slot (falls back to the main model — R11); the chat agent is never asked to
// summarize and no user-visible turn exists (the async half of R5).
async function summarize(deps: CompactionPassDeps, characterId: string, boundary: Boundary): Promise<void> {
  const span = deps.timeline.rangeAscending(characterId, boundary.oldThrough, boundary.newThrough);
  if (span.length === 0) return;
  const previous = deps.summaries.get(characterId)?.text ?? null;
  const prompt = buildCompactionPrompt(previous, renderTranscript(span), Date.now());
  const result = await deps.slot.run("compact", () => generateText({ model: deps.slot.model, prompt }));
  if (result === undefined || result.text.trim().length === 0) {
    // A thrown failure was already warned by the slot; empty text is the Hermes reject-empty guard. Either way
    // the record stays put and the next trigger retries (auto-memory's failure convention).
    deps.logger.warn({ characterId, through: boundary.newThrough }, "summary generation failed; will retry");
    return;
  }
  // Stored VERBATIM — no length cut exists anywhere on this path (owner ruling 2026-08-02: quality over length;
  // a silently truncated rolling summary would propagate its damage into every future merge).
  deps.summaries.upsert({ characterId, throughSeq: boundary.newThrough, text: result.text });
  deps.logger.info(
    { characterId, throughSeq: boundary.newThrough, before: boundary.before, after: deps.view.estimatedTokens(characterId) },
    "conversation compacted",
  );
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
