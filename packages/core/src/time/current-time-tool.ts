/**
 * INPUT:  an LLM get_current_time call (no args)
 * OUTPUT: createCurrentTimeTool() -> ToolSet { get_current_time }; returns { ok, iso, local, timezone, epochMs, capturedAt }
 * POS:    core/time — a PURE Core tool (reads new Date(); NOT a capability — no OS crossing, no Gate, no approval);
 *         informational (NOT presentation — never added to PRESENTATION_TOOL_NAMES); execute NEVER throws
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";

export function createCurrentTimeTool(): ToolSet {
  return {
    get_current_time: tool({
      description:
        "Return the precise current wall-clock time: an ISO 8601 timestamp, the user's local time string, their " +
        "IANA timezone, and epoch milliseconds. Call this only when you need second-level precision, the exact " +
        "timezone, or a machine timestamp for a calculation. Do NOT call it just to know the date or the rough time " +
        "of day — the current date and local time are already in your instructions. Takes no arguments.",
      inputSchema: z.object({}),
      execute: () => {
        try {
          const now = new Date();
          return {
            ok: true as const,
            iso: now.toISOString(),
            local: now.toLocaleString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            epochMs: now.getTime(),
            // Q5 class marker: identical to `iso` BY CONSTRUCTION (same Date) — every state-snapshot result carries
            // capturedAt, so batch 7's folds read one field name across the class instead of special-casing this tool.
            capturedAt: now.toISOString(),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
