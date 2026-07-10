/**
 * INPUT:  a timeline segment (about to leave the replay window) + characterId, a model, and characterId-bound tools
 * OUTPUT: createFlushWriter({model, createTools}) -> { run } — one SILENT tool-enabled turn; output discarded
 * POS:    core/memory — auto-write path 3 (pre-compaction flush, OpenClaw pattern); no timeline rows, no WS, no fs
 */
import { ToolLoopAgent, isStepCount, type LanguageModel, type ToolSet } from "ai";
import type { TimelineEntry } from "@taki/shared";
import { renderTranscript } from "./render-transcript.ts";

export interface FlushWriter {
  /** Extract durable memories from the leaving segment via memory_write; the model's text reply is discarded. */
  run(input: { characterId: string; segment: TimelineEntry[] }): Promise<void>;
}

// The extractor drives memory_write itself (writes ride the store API through the bound tools); its prose reply is
// never shown or persisted — this is a background turn, not a chat turn.
const FLUSH_PROMPT =
  "This conversation segment is about to fall out of your working memory. Extract every durable fact, promise, " +
  "preference, or milestone worth keeping and save each one by calling memory_write (choose the right layer and " +
  "importance). Do not save fleeting chit-chat. When done, reply with just DONE.";

// A handful of writes at most; the cap only guards against a runaway loop (the turn ends cleanly on the limit).
const MAX_STEPS = 8;

export function createFlushWriter(deps: {
  model: LanguageModel;
  createTools: (characterId: string) => ToolSet;
}): FlushWriter {
  return {
    async run({ characterId, segment }) {
      const agent = new ToolLoopAgent({
        model: deps.model,
        instructions: FLUSH_PROMPT,
        tools: deps.createTools(characterId),
        stopWhen: isStepCount(MAX_STEPS),
      });
      // generate() runs the tool loop to completion; we intentionally read nothing off the result (silent turn).
      await agent.generate({ prompt: renderTranscript(segment) });
    },
  };
}
