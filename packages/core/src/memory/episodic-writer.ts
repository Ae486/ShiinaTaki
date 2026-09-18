/**
 * INPUT:  a timeline segment + characterId, an injected LanguageModel, and a bound memory write op
 * OUTPUT: createEpisodicWriter({model, writeMemory}) -> { summarize } — 0..3 entries in the layer the model chooses
 * POS:    core/memory — auto-write path 2 (MEMORY-DESIGN §Write paths); non-streaming generate, no fs (store owns IO)
 */
import { ToolLoopAgent, type LanguageModel } from "ai";
import { z } from "zod";
import type { TimelineEntry } from "@taki/shared";
import { AUTO_LAYER_CHOICES, autoLayerGuidance, clampAutoImportance, resolveAutoLayer } from "./auto-layer-policy.ts";
import type { MemoryOrigin } from "./entry.ts";
import { renderTranscript } from "./render-transcript.ts";
import { MEMORY_VOICE_RULE, WRITE_GATE_RULE } from "./write-convention.ts";

export interface MemoryWriteOp {
  (input: {
    characterId: string;
    layer: string;
    content: string;
    importance: number;
    disclosure?: string;
    origin?: MemoryOrigin;
    turnSeq?: number;
  }): { id: string; kind?: "memory" | "source" | "pending-operation" }
    | Promise<{ id: string; kind?: "memory" | "source" | "pending-operation" }>;
}

export interface EpisodicWriter {
  /** Apply the write gate to the segment; returns the written entry ids (empty is the normal outcome — T5-R15). */
  summarize(input: { characterId: string; segment: TimelineEntry[] }): Promise<{ entryIds: string[] }>;
}

// Strict-JSON contract keeps parsing dependency-free; the model returns an array so 0-N entries share one shape.
// The old prompt asked for "1 to 3 summaries" — a production quota that manufactured low-value rows on a schedule
// (T5-R15). The cap below is a runaway guard only; there is no longer a floor.
const EPISODIC_PROMPT = [
  "You are reviewing a stretch of conversation you just had with the user, deciding what is worth remembering.",
  WRITE_GATE_RULE,
  MEMORY_VOICE_RULE,
  `Choose the layer that fits what you are keeping: ${autoLayerGuidance()}.`,
  'Reply with ONLY a JSON array, each item {"layer": string, "content": string, "importance": integer, ' +
    '"disclosure"?: string}. `content` is one sentence in the conversation\'s language. `disclosure` is a short ' +
    "phrase describing WHEN this should come back to you, worded the way the question would be asked " +
    "('用户问自己叫什么'). If nothing meets the bar, reply []. No prose, no code fences.",
].join("\n\n");

const MAX_SUMMARIES = 3;

const SummarySchema = z.object({
  // A layer outside the auto set (`relationship` is the tempting one — the write TOOL's description highlights it)
  // degrades to the fallback instead of failing the parse: one misfiled searchable row is Q11-1's accepted cost,
  // whereas a thrown parse would drop every other summary in the same pass.
  layer: z.enum(AUTO_LAYER_CHOICES).optional().catch(undefined),
  content: z.string().min(1),
  importance: z.number().optional(),
  disclosure: z.string().optional(),
});
const SummariesSchema = z.array(SummarySchema);

export function createEpisodicWriter(deps: { model: LanguageModel; writeMemory: MemoryWriteOp }): EpisodicWriter {
  return {
    async summarize({ characterId, segment }) {
      const agent = new ToolLoopAgent({ model: deps.model, instructions: EPISODIC_PROMPT });
      const result = await agent.generate({ prompt: renderTranscript(segment) });
      const summaries = SummariesSchema.parse(parseJsonPayload(result.text)).slice(0, MAX_SUMMARIES);
      // The segment's last seq identifies the turn this pass judged — carried onto any R9 reinforce event it causes.
      const turnSeq = segment.at(-1)?.seq;

      const entryIds: string[] = [];
      for (const summary of summaries) {
        const layer = resolveAutoLayer(summary.layer);
        const written = await deps.writeMemory({
          characterId,
          layer,
          content: summary.content,
          importance: clampAutoImportance(layer, summary.importance),
          disclosure: summary.disclosure,
          turnSeq,
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

// Canonical ingestion applies eligibility once before extraction. Reuse only the
// established fact codec/runaway bound here, never this legacy writer's gate.
export { MAX_SUMMARIES as AUTOMATIC_MEMORY_MAX_FACTS, SummariesSchema as AutomaticMemorySummariesSchema,
  parseJsonPayload as parseAutomaticMemoryPayload };
