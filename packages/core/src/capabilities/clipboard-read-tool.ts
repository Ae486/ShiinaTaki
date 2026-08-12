/**
 * INPUT:  an LLM clipboard-read call (no args) + a ConnectionRegistry and CapabilityBroker
 * OUTPUT: createClipboardReadTool(deps) -> ToolSet { clipboard_read }; returns { ok, text, capturedAt } or { ok:false, code }
 * POS:    core/capabilities — the agent tool; route→broker; execute NEVER throws (Shell-gated, ruling 6)
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ClipboardReadOutputSchema } from "@taki/shared";
import { captureStamp } from "./capture-stamp.ts";
import { routeCapability, type CapabilityRouteDeps } from "./route-capability.ts";

const CAPABILITY = "clipboard-read";

export type ClipboardReadToolDeps = CapabilityRouteDeps;

export function createClipboardReadTool(deps: ClipboardReadToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "capability" });
  return {
    clipboard_read: tool({
      description:
        "Read the current text contents of the user's clipboard. The user is asked to approve on their device. " +
        "An empty clipboard returns an empty string.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const routed = await routeCapability(deps, { capabilityId: CAPABILITY, input: {} });
          if (!routed.ok) return routed;
          const output = ClipboardReadOutputSchema.parse(routed.output);
          // The clipboard text is content — log only that a read happened, never the text itself.
          log.info({ empty: output.text.length === 0 }, "clipboard read");
          // capturedAt: the snapshot's capture moment (Q5) — persists byte-stable into replay.
          return { ok: true as const, text: output.text, capturedAt: captureStamp() };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "clipboard-read tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
