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
        "Run one executable with arguments on the selected Execution Host; command is one string, with no implicit shell. " +
        "Bare program names use the trusted PATH (cwd excluded); if lookup fails, choose an installed program or its absolute path before retrying. " +
        "Quote paths/arguments containing spaces; quotes group arguments and backslashes are literal. " +
        "For chaining, pipes, redirection or expansion, invoke an installed interpreter with the script as one quoted argument. " +
        "Examples when installed: `git --version`; on Windows, `powershell.exe -NoProfile -NonInteractive -Command \"Get-ChildItem -Name | Select-Object -First 5\"`. " +
        "Each call starts a fresh process at the Host's configured cwd with a scrubbed environment; cwd/env changes do not persist. " +
        "Prefer dedicated file tools for reads/edits when available. Current policy may allow, require approval or refuse execution; approval does not add a shell. " +
        "ok:true alone is not command success: read exitCode, stdout and stderr; a nonzero exitCode, timedOut:true or truncated:true is an execution result, not a tool error.",
      inputSchema: z.object({ command: z.string().min(1) }),
      execute: async ({ command }) => {
        try {
          // The command + its output are content (may carry paths/secrets) — the Shell shows/audits it; never logged here.
          const routed = await routeCapability(deps, { capabilityId: CAPABILITY, input: { command } });
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
