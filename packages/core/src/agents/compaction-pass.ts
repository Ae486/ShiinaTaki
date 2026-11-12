/**
 * INPUT:  replay size/budget, Timeline/Summary repos, selected provider retirement evidence, the UtilitySlot,
 *         the compaction knobs (context-config), a Logger; maybeRun(characterId) per completed turn
 * OUTPUT: createCompactionPass(deps) -> durable coordinator plus the reviewed prompt contract
 * POS:    core/agents — T5-R5's background compactor: an EXTERNAL summarizer on the utility slot (never the chat
 *         agent), independently admitted from Local extraction; selected Legacy/Hindsight ports prove coverage first; through_seq advances
 *         only on validated, fenced summary success; the chat turn never waits
 */
import { MEMORY_VOICE_RULE } from "../memory/write-convention.ts";
import { renderDayDate } from "../time/time-context.ts";
import {
  createCompactionCoordinator,
  type CompactionCoordinator,
  type CompactionCoordinatorDeps,
} from "./compaction-coordinator.ts";

/*
 * The summary prompt is research/re-compaction-prompts.md Part D (the owner-reviewed draft), transcribed with the
 * three ruled amendments, plus the source-preservation clarification below:
 *   (a) the closing "Aim for about {TAKI_COMPACT_SUMMARY_TOKENS} tokens." line is DELETED (owner 2026-08-02: no
 *       length limit, no truncation, no knob) and REPLACED with Letta's quality closer;
 *   (b) the 2026-11-01 owner-approved decoupling preserves salient facts in the summary while canonical extraction
 *       is delayed; the summarizer cannot assume long-term memory has already stored them;
 *   (c) {MEMORY_VOICE_RULE} stays a whole-constant import (the tidy-pass precedent — one voice, R10).
 * The source clarification preserves relevant reported events/negations across different subjects and avoids
 * inventing correction history from native roles. It does not change Memory eligibility or summary quality gates.
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

Keep salient names, preferences, hard boundaries and constraints needed for future
continuity, whether they appear in the earlier record or the new material.
Do not assume these facts have already been stored in long-term memory.

WHAT TO LET GO: logistics that are finished and settled; back-and-forth that reached a
conclusion already recorded above; pleasantries; anything still visible in the recent
messages that follow this record. Keep the salient facts alongside what HAPPENED and
what is ONGOING; drop a relevant fact only when the material clearly supersedes it.

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

For events relevant to the retained thread, keep the source/person attached to each
reported event and explicit negation when similar events involve different people.
A user's clarification does not retract another person's sourced event unless the
transcript says so. An assistant-role message with a supplied material source is not
evidence of a previous attribution mistake. Do not invent a correction narrative from
that role alone.

This record may be the only available context for that stretch of conversation while
long-term memory extraction is pending. Every word
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

export type CompactionPassDeps = Omit<CompactionCoordinatorDeps, "buildPrompt">;
export type { CompactionCoordinator, CompactionLogger, CompactionView } from "./compaction-coordinator.ts";

export function createCompactionPass(deps: CompactionPassDeps): CompactionCoordinator {
  return createCompactionCoordinator({ ...deps, buildPrompt: buildCompactionPrompt });
}
