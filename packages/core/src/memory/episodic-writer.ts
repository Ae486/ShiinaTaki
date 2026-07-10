/**
 * INPUT:  a timeline segment + characterId, an injected LanguageModel, and a bound episode write op
 * OUTPUT: createEpisodicWriter({model, writeEpisode}) -> { summarize } — 1-3 episode entries via the store API
 * POS:    core/memory — auto-write path 2 (MEMORY-DESIGN §Write paths); non-streaming generate, no fs (store owns IO)
 */
import { ToolLoopAgent, type LanguageModel } from "ai";
import { z } from "zod";
import type { TimelineEntry } from "@taki/shared";
import { renderTranscript } from "./render-transcript.ts";

export interface EpisodicWriteOp {
  (input: { characterId: string; content: string; importance: number; disclosure?: string }): { id: string };
}

export interface EpisodicWriter {
  /** Summarize the segment into episode entries; returns the written entry ids (may be empty when nothing is worth keeping). */
  summarize(input: { characterId: string; segment: TimelineEntry[] }): Promise<{ entryIds: string[] }>;
}

// Strict-JSON contract keeps parsing dependency-free; the model returns an array so 0-3 summaries share one shape.
const EPISODIC_PROMPT =
  "You are a memory summarizer. Read the conversation transcript and extract 1 to 3 concise episode summaries " +
  "worth remembering long-term (notable moments, decisions, feelings, facts learned). Skip fleeting chit-chat. " +
  'Reply with ONLY a JSON array, each item {"content": string, "importance": integer 3-7, "disclosure"?: string}. ' +
  "content is a single sentence in the conversation's language. If nothing is worth keeping, reply []. No prose, no code fences.";

const IMPORTANCE_MIN = 3;
const IMPORTANCE_MAX = 7;
const MAX_SUMMARIES = 3;

const SummarySchema = z.object({
  content: z.string().min(1),
  importance: z.number().optional(),
  disclosure: z.string().optional(),
});
const SummariesSchema = z.array(SummarySchema);

export function createEpisodicWriter(deps: { model: LanguageModel; writeEpisode: EpisodicWriteOp }): EpisodicWriter {
  return {
    async summarize({ characterId, segment }) {
      const agent = new ToolLoopAgent({ model: deps.model, instructions: EPISODIC_PROMPT });
      const result = await agent.generate({ prompt: renderTranscript(segment) });
      const summaries = SummariesSchema.parse(parseJsonPayload(result.text)).slice(0, MAX_SUMMARIES);

      const entryIds: string[] = [];
      for (const summary of summaries) {
        const written = deps.writeEpisode({
          characterId,
          content: summary.content,
          importance: clampImportance(summary.importance),
          disclosure: summary.disclosure,
        });
        entryIds.push(written.id);
      }
      return { entryIds };
    },
  };
}

// Tolerant of a stray ```json fence the model may add despite the instruction; a non-JSON body throws (caller warns).
function parseJsonPayload(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(stripped);
}

function clampImportance(value: number | undefined): number {
  const rounded = Math.round(value ?? 5);
  return Math.max(IMPORTANCE_MIN, Math.min(IMPORTANCE_MAX, rounded));
}
