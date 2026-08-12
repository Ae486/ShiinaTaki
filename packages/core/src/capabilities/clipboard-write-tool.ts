/**
 * INPUT:  an LLM clipboard-write call ({ text }) + a ConnectionRegistry and CapabilityBroker
 * OUTPUT: createClipboardWriteTool(deps) -> ToolSet { clipboard_write }; returns { ok:true } or { ok:false, code }
 * POS:    core/capabilities — the agent tool; route→broker; execute NEVER throws (Shell-gated, ruling 6)
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ClipboardWriteOutputSchema } from "@taki/shared";
import { routeCapability, type CapabilityRouteDeps } from "./route-capability.ts";

const CAPABILITY = "clipboard-write";

export type ClipboardWriteToolDeps = CapabilityRouteDeps;

export function createClipboardWriteTool(deps: ClipboardWriteToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "capability" });
  return {
    clipboard_write: tool({
      description:
        "Replace the text contents of the user's clipboard. The user is asked to approve on their device.",
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }) => {
        try {
          // The text is content — it rides to the node as input but never enters a core log.
          const routed = await routeCapability(deps, { capabilityId: CAPABILITY, input: { text } });
          if (!routed.ok) return routed;
          ClipboardWriteOutputSchema.parse(routed.output);
          log.info({ bytes: Buffer.byteLength(text, "utf8") }, "clipboard written");
          return { ok: true as const };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "clipboard-write tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
