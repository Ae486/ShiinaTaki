/**
 * INPUT:  an LLM screenshot call (no args) + a ConnectionRegistry, CapabilityBroker, ScreenshotStore
 * OUTPUT: createScreenshotTool(deps) -> ToolSet { screenshot }; returns { ok, path, width, height, bytes } or { ok:false, code }
 * POS:    core/capabilities — the agent tool; thin over route→broker→persist; execute NEVER throws (ruling 7/8A)
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Logger } from "../logging/logger.ts";
import type { ConnectionRegistry } from "../server/connection-registry.ts";
import type { CapabilityBroker } from "./capability-broker.ts";
import type { ScreenshotStore } from "./screenshot-store.ts";

const CAPABILITY = "screenshot";

export interface ScreenshotToolDeps {
  registry: ConnectionRegistry;
  broker: CapabilityBroker;
  store: ScreenshotStore;
  logger: Logger;
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
          const node = deps.registry.findNodeForCapability(CAPABILITY);
          if (!node?.notify) {
            return { ok: false as const, code: "NO_NODE", message: "no connected device can take a screenshot" };
          }
          const outcome = await deps.broker.request(CAPABILITY, {}, node.notify);
          if (!outcome.ok) return { ok: false as const, code: outcome.code, message: outcome.message };

          const { path, bytes } = deps.store.save(outcome.output.dataBase64);
          log.info({ width: outcome.output.width, height: outcome.output.height, bytes }, "screenshot persisted");
          return {
            ok: true as const,
            path,
            width: outcome.output.width,
            height: outcome.output.height,
            bytes,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "screenshot tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
