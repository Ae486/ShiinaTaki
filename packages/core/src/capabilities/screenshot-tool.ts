/**
 * INPUT:  an LLM screenshot call (no args) + a ConnectionRegistry, CapabilityBroker, ScreenshotStore
 * OUTPUT: createScreenshotTool(deps) -> ToolSet { screenshot }; returns { ok, path, width, height, bytes } or { ok:false, code }
 * POS:    core/capabilities — the agent tool; thin over route→broker→persist; execute NEVER throws (ruling 7/8A)
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ScreenshotOutputSchema } from "@taki/shared";
import { routeCapability, type CapabilityRouteDeps } from "./route-capability.ts";
import type { ScreenshotStore } from "./screenshot-store.ts";

const CAPABILITY = "screenshot";

export interface ScreenshotToolDeps extends CapabilityRouteDeps {
  store: ScreenshotStore;
}

export function createScreenshotTool(deps: ScreenshotToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "capability" });
  return {
    screenshot: tool({
      description:
        "Capture a screenshot of the user's primary monitor. The user is asked to approve on their device; " +
        "on success you receive the saved file path and its pixel dimensions (the image itself is stored, not shown to you).",
      inputSchema: z.object({}),
      // Every failure degrades into a structured result the model can read; this execute never throws (error-handling spec).
      execute: async () => {
        try {
          const routed = await routeCapability(deps, CAPABILITY, {});
          if (!routed.ok) return routed;

          // The channel output is opaque (Option A); the screenshot tool owns and parses its own payload shape.
          const output = ScreenshotOutputSchema.parse(routed.output);
          const { path, bytes } = deps.store.save(output.dataBase64);
          log.info({ width: output.width, height: output.height, bytes }, "screenshot persisted");
          return { ok: true as const, path, width: output.width, height: output.height, bytes };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "screenshot tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
