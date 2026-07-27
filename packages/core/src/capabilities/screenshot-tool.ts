/**
 * INPUT:  an LLM screenshot call ({ describePrompt? }) + a ConnectionRegistry, CapabilityBroker, ScreenshotStore, and
 *         an optional VLM describe bridge (screenshot-describe, wired only when the vision slot is configured)
 * OUTPUT: createScreenshotTool(deps) -> ToolSet { screenshot }; returns { ok, path, width, height, bytes,
 *         description? } or { ok:false, code } — description present only when the VLM bridge produced one, and then
 *         only PII-scrubbed and wrapped in the A1 untrusted fence (D44)
 * POS:    core/capabilities — the agent tool; thin over route→broker→persist(→describe→scrub→fence); execute NEVER throws (ruling 7/8A).
 *         Risk posture (MCP vocab, doc-only — the Rust Permission Gate is the sole enforcement, tool-design I1/C-5): readOnly (does not modify the screen), open-world (VLM description is untrusted content), gated (sensitive capture, approval required).
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ScreenshotOutputSchema } from "@taki/shared";
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import { scrubPii } from "../perception/pii-scrub.ts";
import { routeCapability, type CapabilityRouteDeps } from "./route-capability.ts";
import type { ScreenshotStore } from "./screenshot-store.ts";

const CAPABILITY = "screenshot";
const DESCRIPTION_SOURCE = "screenshot-vlm";

// D44 closure: the VLM description is open-world content (whatever text happened to be on screen, including a
// hostile "ignore previous instructions"). It reaches the model ONLY scrubbed then fenced — scrub-then-fence, the
// same order and the same two modules the ambient path uses (prd ruling 5; spec agent-runtime §fence).
function safeDescription(description: string): string {
  return fenceUntrusted({ source: DESCRIPTION_SOURCE, content: scrubPii(description) });
}

export interface ScreenshotToolDeps extends CapabilityRouteDeps {
  store: ScreenshotStore;
  /** Optional screenshot→VLM bridge; a null description (failure/empty) degrades to the plain result. */
  describe?: (input: { dataBase64: string; mediaType: string; prompt?: string }) => Promise<string | null>;
}

export function createScreenshotTool(deps: ScreenshotToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "capability" });
  return {
    screenshot: tool({
      description:
        "Capture a screenshot of the user's primary monitor. The user is asked to approve on their device; " +
        (deps.describe
          ? "on success you receive the saved file path, its pixel dimensions, and a textual description of the screen. " +
            "You may optionally supply describePrompt to focus that description on what you need."
          : "on success you receive the saved file path and its pixel dimensions (the image itself is stored, not shown to you)."),
      inputSchema: z.object({
        // Steers only HOW the screen is described, never WHAT is captured — capture crosses the gate unchanged (T2b §3.6).
        describePrompt: z
          .string()
          .max(500)
          .optional()
          .describe("Optional focus for the screen description, e.g. 'the error dialog text'. Ignored when no vision model is configured."),
      }),
      // Every failure degrades into a structured result the model can read; this execute never throws (error-handling spec).
      execute: async ({ describePrompt }) => {
        try {
          const routed = await routeCapability(deps, CAPABILITY, {});
          if (!routed.ok) return routed;

          // The channel output is opaque (Option A); the screenshot tool owns and parses its own payload shape.
          const output = ScreenshotOutputSchema.parse(routed.output);
          const { path, bytes } = deps.store.save(output.dataBase64);
          // The describe bridge reads the in-flight bytes (no fs round-trip); its failures degrade to null inside it.
          const description = deps.describe
            ? await deps.describe({ dataBase64: output.dataBase64, mediaType: output.mediaType, prompt: describePrompt })
            : null;
          log.info({ width: output.width, height: output.height, bytes, described: description !== null }, "screenshot persisted");
          const result = { ok: true as const, path, width: output.width, height: output.height, bytes };
          return description === null ? result : { ...result, description: safeDescription(description) };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "screenshot tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
