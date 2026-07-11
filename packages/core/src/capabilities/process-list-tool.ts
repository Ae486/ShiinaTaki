/**
 * INPUT:  an LLM process-list call (no args) + a ConnectionRegistry and CapabilityBroker
 * OUTPUT: createProcessListTool(deps) -> ToolSet { process_list }; returns { ok, processes, count } or { ok:false, code }
 * POS:    core/capabilities — the agent tool; thin over route→broker; execute NEVER throws (Shell-gated, ruling 5)
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ProcessListOutputSchema } from "@taki/shared";
import type { Logger } from "../logging/logger.ts";
import { routeCapability, type CapabilityRouteDeps } from "./route-capability.ts";

const CAPABILITY = "process-list";

export type ProcessListToolDeps = CapabilityRouteDeps & { logger: Logger };

export function createProcessListTool(deps: ProcessListToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "capability" });
  return {
    process_list: tool({
      description:
        "List the processes currently running on the user's device (pid, name, parent pid, memory, start time). " +
        "The user is asked to approve on their device. Read-only: this cannot start or stop any process.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const routed = await routeCapability(deps, CAPABILITY, {});
          if (!routed.ok) return routed;
          const output = ProcessListOutputSchema.parse(routed.output);
          log.info({ count: output.count }, "process list returned");
          return { ok: true as const, processes: output.processes, count: output.count };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "process-list tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
