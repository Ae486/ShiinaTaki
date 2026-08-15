/**
 * INPUT:  operator capability.trigger params ({ capability, input? }) + a ToolSet of the agent's real tools + a Logger
 * OUTPUT: capabilityTriggerMethod({ tools, logger }) -> MethodDefinition (operator-only); devTriggerEnabled(env)
 * POS:    core/server/methods — DEV-ONLY L1 drive: invokes a real capability tool's execute WITHOUT the LLM. Registered
 *         in main.ts ONLY when TAKI_DEV_TRIGGER === "1". NOT a gate bypass — it drives the same tool.execute the agent
 *         does, so the node-side Permission Gate still authorizes every call. The params schema stays HERE (dev-only
 *         surface): never in @taki/shared, never mirrored in Rust (invariant 3 is for the real protocol only).
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ToolSet } from "ai";
import type { Logger } from "../../logging/logger.ts";
import type { Connection } from "../connection-registry.ts";
import type { MethodDefinition } from "../method-registry.ts";

const CAPABILITY_TRIGGER_METHOD = "capability.trigger";

// The dev surface's own schema (kept out of @taki/shared on purpose): capability names the tool bag key, input is the
// opaque per-tool payload the operator supplies, interactive binds the CALLING operator socket as the Approval owner
// (drives the challenge/resume L1 without an LLM). strictObject so a stray key is a clear INVALID_PARAMS in tests.
const CapabilityTriggerParamsSchema = z.strictObject({
  capability: z.string().min(1),
  input: z.unknown().optional(),
  interactive: z.boolean().optional(),
});
type CapabilityTriggerParams = z.infer<typeof CapabilityTriggerParamsSchema>;

/** Strict env gate: the trigger is registered ONLY when this returns true (exact "1", never "true"/"0"/unset). */
export function devTriggerEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.TAKI_DEV_TRIGGER === "1";
}

export interface CapabilityTriggerDeps {
  /** Builds the SAME tool bag the agent drives (six Shell-routed + the Workspace file tools) — never a separate path. */
  tools: (interactive?: { connection: Connection }) => ToolSet;
  logger: Logger;
}

export function capabilityTriggerMethod(deps: CapabilityTriggerDeps): MethodDefinition<CapabilityTriggerParams> {
  const log = deps.logger.child({ mod: "dev-trigger" });
  return {
    method: CAPABILITY_TRIGGER_METHOD,
    // Operators drive; a node never asks core to run a capability (mirror of the operator-only chat/approval methods).
    roles: ["operator"],
    paramsSchema: CapabilityTriggerParamsSchema,
    handler: async (params, ctx) => {
      // Interactive drives bind THIS operator socket as the initiating operator — the same per-turn construction the
      // chat agent uses — so an ask-classified capability prompts the driving socket instead of failing unattended.
      const tools = deps.tools(params.interactive ? { connection: ctx.connection } : undefined);
      const execute = tools[params.capability]?.execute;
      if (typeof execute !== "function") {
        return {
          ok: false as const,
          code: "UNSUPPORTED_CAPABILITY",
          message: `no capability tool registered for ${params.capability}`,
        };
      }
      // Loud on every use — a dev drive that reaches a real capability tool must never be silent (mirror ScriptedApprover).
      log.warn({ capability: params.capability, interactive: params.interactive === true }, "DEV CAPABILITY TRIGGER — running a real tool execute without the LLM");
      // The tool's execute is typed to its own input; the trigger drives it with an opaque operator-supplied payload
      // and an empty message context. The tool's route → broker → node-side gate path is unchanged (no bypass).
      const run = execute as unknown as (
        input: unknown,
        options: { toolCallId: string; messages: [] },
      ) => Promise<unknown>;
      return run(params.input ?? {}, { toolCallId: randomUUID(), messages: [] });
    },
  };
}
