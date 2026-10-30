/**
 * INPUT:  n/a (static prompt text)
 * OUTPUT: WRITE_GATE_RULE (T5-R15) + MEMORY_VOICE_RULE (T5-R10) — the two fragments every memory-write prompt shares
 * POS:    core/memory — the ONE wording convention for the write side; episodic + flush import it (compaction joins in
 *         batch 7). Three prompts must never grow three different voices, so the text lives here, not in the writers.
 */
import { SOURCE_INTERPRETATION_RULE } from "../agents/source-interpretation.ts";

/**
 * T5-R15. The gate is a BEHAVIOUR-CHANGE test, not a production quota: the old "extract 1 to 3 summaries" asked for
 * output on a schedule and manufactured low-value rows. Silence must read as the PREFERRED outcome, not as grudging
 * permission — mem0's "you CAN return an empty list" is the counter-example whose few-shot examples still taught
 * extracting "Sky is blue".
 */
export const WRITE_GATE_RULE =
  "Save something only when it is likely to change your future responses in similar situations. That is the whole " +
  "test — not whether it is important, interesting, or new.\n" +
  "Do NOT save: short-lived details that stop mattering within the day; trivia; anything your memory already holds; " +
  "personal matters beyond what this relationship warrants; or text the user merely asked you to translate, rewrite, " +
  "or summarize.\n" +
  "Override: when the user explicitly asked you to remember something, save it even if it looks trivial or already known.\n" +
  "Most stretches of conversation are worth nothing at all. Writing nothing is the normal, expected outcome — prefer " +
  "it over reaching for something to say.\n\n" + SOURCE_INTERPRETATION_RULE;

/**
 * T5-R10. One person/wording convention across every write path. The second reason is the decisive one: with a single
 * permitted search and no retry, an entry phrased in the user's own words ("很烦") can be hit by their later question,
 * while a minutes-of-meeting paraphrase ("负面情绪") shares no substring with it at all.
 */
export const MEMORY_VOICE_RULE =
  "Write each memory in the FIRST PERSON, from your own point of view — this is you remembering, not a report about you.\n" +
  "Keep the user's actual words (他说「很烦」, not 「表达了负面情绪」; 「卡住了」, not 「遇到技术障碍」).\n" +
  "Write only what appears in the transcript. Never infer, guess, or fill in what was not said.\n" +
  "Use absolute dates and times (2026-07-28, 周五晚上), never 「今天」/「最近」 — the memory is kept indefinitely and " +
  "will be read long after the relative word stops being true.\n" +
  "The first-person narrator is the Companion remembering. Keep the actual subject of the remembered event; " +
  "a discussion of an external person's experience does not make it the user's biography.\n\n" + SOURCE_INTERPRETATION_RULE;
