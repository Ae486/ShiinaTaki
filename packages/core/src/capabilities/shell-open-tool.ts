/**
 * INPUT:  an LLM shell-open call ({ kind, target }) + a ConnectionRegistry and CapabilityBroker
 * OUTPUT: createShellOpenTool(deps) -> ToolSet { shell_open }; returns { ok:true, opened } or { ok:false, code }
 * POS:    core/capabilities — the agent tool; route→broker; execute NEVER throws (Shell-gated; dialog shows target, ruling 3/4)
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ShellOpenOutputSchema } from "@taki/shared";
import { routeCapability, type CapabilityRouteDeps } from "./route-capability.ts";

const CAPABILITY = "shell-open";

export type ShellOpenToolDeps = CapabilityRouteDeps;

export function createShellOpenTool(deps: ShellOpenToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "capability" });
  return {
    shell_open: tool({
      description:
        "Open a URL or a file/folder path with the system default application on the user's device. " +
        "The user is asked to approve and sees the exact target. URLs must be http, https or mailto.",
      inputSchema: z.object({ kind: z.enum(["url", "path"]), target: z.string().min(1) }),
      execute: async ({ kind, target }) => {
        try {
          // The target is content (may reveal what the user is browsing) — the node shows it in the dialog, never logged here.
          const routed = await routeCapability(deps, CAPABILITY, { kind, target });
          if (!routed.ok) return routed;
          const output = ShellOpenOutputSchema.parse(routed.output);
          log.info({ kind }, "shell-open launched");
          return { ok: true as const, opened: output.opened };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "shell-open tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
