/**
 * INPUT:  a timeline segment (about to leave the replay window) + characterId, a model, and characterId-bound tools
 *         (the BACKGROUND set — its memory_write cannot reach the always-visible rung, Q11-1)
 * OUTPUT: createFlushWriter({model, createTools, slot?}) -> { run } — one SILENT tool-enabled turn; prose discarded,
 *         only the successful memory_write count returned; an injected slot serializes the model call process-wide
 * POS:    core/memory — auto-write path 3 (pre-compaction flush, OpenClaw pattern); no timeline rows, no WS, no fs
 */
import { ToolLoopAgent, isStepCount, type LanguageModel, type ToolSet } from "ai";
import type { TimelineEntry } from "@taki/shared";
import { renderTranscript } from "./render-transcript.ts";
import type { UtilitySlot } from "./utility-slot.ts";
import { MEMORY_VOICE_RULE, WRITE_GATE_RULE } from "./write-convention.ts";

export interface FlushWriter {
  /**
   * Extract durable memories from the leaving segment via memory_write; the model's text reply is discarded.
   * `writes` is how many times a memory_write SUCCEEDED — zero is the T5-R15 normal outcome, and the caller
   * logs it as a skip so "nothing was worth keeping" stays distinguishable from "the writer is broken".
   */
  run(input: { characterId: string; segment: TimelineEntry[] }): Promise<{ writes: number }>;
}

// The extractor drives memory_write itself (writes ride the store API through the bound tools); its prose reply is
// never shown or persisted — this is a background turn, not a chat turn. It shares the episodic writer's gate and
// voice verbatim (T5-R15/R10): two prompts over the same store must not grow two different standards.
const FLUSH_PROMPT = [
  "This stretch of conversation is about to fall out of your working memory — this is your last chance to keep " +
    "anything from it. Save what is worth keeping by calling memory_write (choose the layer and importance yourself).",
  WRITE_GATE_RULE,
  MEMORY_VOICE_RULE,
  "When you are done — including when you decided to save nothing — reply with just DONE.",
].join("\n\n");

// A handful of writes at most; the cap only guards against a runaway loop (the turn ends cleanly on the limit).
const MAX_STEPS = 8;
// The tool whose absence means the gate declined — named in FLUSH_PROMPT too, so the two must agree.
const WRITE_TOOL_NAME = "memory_write";

export function createFlushWriter(deps: {
  model: LanguageModel;
  createTools: (characterId: string) => ToolSet;
  /** Optional process-wide queue; production injects the shared Utility Slot used by all background model calls. */
  slot?: UtilitySlot;
}): FlushWriter {
  return {
    async run({ characterId, segment }) {
      const execute = async () => {
        const agent = new ToolLoopAgent({
          model: deps.model,
          instructions: FLUSH_PROMPT,
          tools: deps.createTools(characterId),
          stopWhen: isStepCount(MAX_STEPS),
        });
        // generate() runs the tool loop to completion; the only thing read off the result is the SUCCESSFUL-write count
        // (the prose reply stays discarded — this is a silent turn). Counting `toolResults` rather than `toolCalls` is
        // deliberate: a schema-rejected call (a layer the background tool forbids) lands in `toolCalls` as an invalid
        // DynamicToolCall and produces no result, so counting calls would read a rejection as a write.
        const result = await agent.generate({ prompt: renderTranscript(segment) });
        const writes = result.toolResults.filter(
          (entry) => entry.toolName === WRITE_TOOL_NAME && isOkResult(entry.output),
        );
        return { writes: writes.length };
      };
      const result = deps.slot ? await deps.slot.run("flush", execute) : await execute();
      if (!result) throw new Error("UTILITY_TASK_FAILED");
      return result;
    },
  };
}

// The tools' shared envelope is core-internal, so the check stays structural rather than importing a result type.
function isOkResult(output: unknown): boolean {
  return typeof output === "object" && output !== null && "ok" in output && output.ok === true;
}
