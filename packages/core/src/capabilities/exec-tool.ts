/**
 * INPUT:  an LLM exec call ({ command }) + a ConnectionRegistry and CapabilityBroker
 * OUTPUT: createExecTool(deps) -> ToolSet { exec }; returns the ExecOutput fields or { ok:false, code }
 * POS:    core/capabilities — the agent tool; opaque `{command}` pass-through parsed Shell-side; execute NEVER throws (ruling 16/17)
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ExecOutputSchema } from "@taki/shared";
import { routeCapability, type CapabilityRouteDeps } from "./route-capability.ts";

const CAPABILITY = "exec";

export type ExecToolDeps = CapabilityRouteDeps;

export function createExecTool(deps: ExecToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "capability" });
  return {
    exec: tool({
      description:
        "Run a shell command on the user's device. The Shell parses and governs it: an allowlisted simple command " +
        "may run automatically, anything else asks the user to approve, and catastrophic commands are refused. " +
        "A nonzero exitCode, a timeout, or truncated output are normal results you should read — not tool errors.",
      inputSchema: z.object({ command: z.string().min(1) }),
      execute: async ({ command }) => {
        try {
          // The command + its output are content (may carry paths/secrets) — the Shell shows/audits it; never logged here.
          const routed = await routeCapability(deps, CAPABILITY, { command });
          if (!routed.ok) return routed;
          const output = ExecOutputSchema.parse(routed.output);
          log.info({ exitCode: output.exitCode, timedOut: output.timedOut, truncated: output.truncated }, "exec ran");
          return { ok: true as const, ...output };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "exec tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
