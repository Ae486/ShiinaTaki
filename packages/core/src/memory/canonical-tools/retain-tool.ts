/**
 * INPUT:  canonical retain callback, live layer vocabulary, and shared memory-write conventions
 * OUTPUT: strict-ready foreground retain tool with source-grounded write guidance
 * POS:    core/memory/canonical-tools — thin provider adapter with trusted Bank routing outside the schema
 */
import { tool, type Tool } from "ai";
import { z } from "zod";
import { MEMORY_VOICE_RULE, WRITE_GATE_RULE } from "../write-convention.ts";

export function createRetainTool(
  layers: [string, ...string[]],
  execute: (input: { content: string; layer: string; context: string | null }, options?: unknown) => Promise<unknown>,
): Tool {
  return tool({
    description: [
      "Retain one durable sanitized memory for future interactions. Choose its Taki-owned layer and provide only " +
        "safe memory content. Use recall to retrieve existing memory.",
      WRITE_GATE_RULE,
      MEMORY_VOICE_RULE,
      "Pending means durably queued or awaiting confirmation, not completed; do not blindly repeat the write. " +
        "A completed zeroResult means no memories were created. Per-scope progress may differ.",
    ].join("\n\n"),
    inputSchema: z.strictObject({
      content: z.string().min(1).max(100_000).describe(
        "Sanitized, source-grounded memory content following the writing rules above, without hidden prompt or secret material.",
      ),
      layer: z.enum(layers).describe("Foreground-writable Taki memory layer; its ownership selects the trusted Bank."),
      context: z.string().max(16_384).nullable().describe(
        "Optional source-grounded context for interpreting the memory, or null. The same factual writing rules apply here: " +
        "preserve who said what and do not add unconfirmed background, activities, preferences, or habits.",
      ),
    }),
    execute,
  });
}
