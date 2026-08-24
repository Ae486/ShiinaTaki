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
import { TriggerRequestSchema } from "@taki/shared";
import type { RunService } from "../../harness/run-service.ts";
import type { Logger } from "../../logging/logger.ts";
import type { TurnInteractive } from "../../mcp/mcp-turn-tools.ts";
import type { MethodContext, MethodDefinition } from "../method-registry.ts";

const CAPABILITY_TRIGGER_METHOD = "capability.trigger";

// The dev surface's own schema (kept out of @taki/shared on purpose): capability names the tool bag key, input is the
// opaque per-tool payload the operator supplies, interactive binds the CALLING operator socket as the Approval owner
// (drives the challenge/resume L1 without an LLM). strictObject so a stray key is a clear INVALID_PARAMS in tests.
const CapabilityTriggerParamsSchema = z.strictObject({
  capability: z.string().min(1),
  input: z.unknown().optional(),
  interactive: z.boolean().optional(),
  lifecycle: z.boolean().optional(),
});
type CapabilityTriggerParams = z.infer<typeof CapabilityTriggerParamsSchema>;

/** Strict env gate: the trigger is registered ONLY when this returns true (exact "1", never "true"/"0"/unset). */
export function devTriggerEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.TAKI_DEV_TRIGGER === "1";
}

export interface CapabilityTriggerDeps {
  /** Builds the SAME tool bag the agent drives (six Shell-routed + the Workspace file tools) — never a separate path. */
  tools: (interactive?: TurnInteractive) => ToolSet;
  logger: Logger;
  /** Optional production lifecycle owner, present in main.ts and omitted by focused legacy-drive tests. */
  runs?: RunService<TurnInteractive>;
}

export function capabilityTriggerMethod(deps: CapabilityTriggerDeps): MethodDefinition<CapabilityTriggerParams> {
  const log = deps.logger.child({ mod: "dev-trigger" });
  return {
    method: CAPABILITY_TRIGGER_METHOD,
    // Operators drive; a node never asks core to run a capability (mirror of the operator-only chat/approval methods).
    roles: ["operator"],
    paramsSchema: CapabilityTriggerParamsSchema,
    handler: (params, ctx) => handleTrigger(deps, log, params, ctx),
  };
}

interface TriggerRun { runId: string; attemptId: string }

// eslint-disable-next-line max-params
async function handleTrigger(
  deps: CapabilityTriggerDeps,
  log: Logger,
  params: CapabilityTriggerParams,
  ctx: MethodContext,
): Promise<unknown> {
  // Lifecycle drives always need the operator binding so the captured context receives Run/Attempt/effect authority.
  const interactive: TurnInteractive | undefined = (params.interactive || params.lifecycle)
    ? { connection: ctx.connection }
    : undefined;
  const admitted = params.lifecycle ? await admitTriggerRun(deps, interactive) : undefined;
  if (admitted && "error" in admitted) return admitted.error;
  const execute = deps.tools(interactive)[params.capability]?.execute;
  if (typeof execute !== "function") {
    settleTriggerRun(deps.runs, admitted, "failed", "unsupported_capability", "capability tool unavailable");
    return { ok: false as const, code: "UNSUPPORTED_CAPABILITY", message: `no capability tool registered for ${params.capability}` };
  }
  log.warn({ capability: params.capability, interactive: params.interactive === true }, "DEV CAPABILITY TRIGGER — running a real tool execute without the LLM");
  return executeTriggerTool({ deps, execute, params, admitted });
}

async function admitTriggerRun(
  deps: CapabilityTriggerDeps,
  interactive: TurnInteractive | undefined,
): Promise<TriggerRun | { error: unknown }> {
  if (!deps.runs) return { error: { ok: false as const, code: "LIFECYCLE_UNAVAILABLE", message: "Run lifecycle is unavailable" } };
  const admitted = await deps.runs.admit(TriggerRequestSchema.parse({
    triggerRequestId: randomUUID(), idempotencyKey: randomUUID(), characterId: "taki", initiator: "primary",
    provenance: { provider: "dev-trigger" }, deliveryClass: "internal", contextMode: "autonomous",
  }), interactive);
  const run = { runId: admitted.run.runId, attemptId: admitted.attempt.attemptId };
  if (interactive) Object.assign(interactive, run);
  return deps.runs.start(run.runId, run.attemptId)
    ? run
    : { error: { ok: false as const, code: "RUN_NOT_STARTED", message: "Run could not be started", ...run } };
}

async function executeTriggerTool(input: {
  deps: CapabilityTriggerDeps;
  execute: NonNullable<ToolSet[string]["execute"]>;
  params: CapabilityTriggerParams;
  admitted?: TriggerRun;
}): Promise<unknown> {
  const run = input.execute as unknown as (value: unknown, options: { toolCallId: string; messages: [] }) => Promise<unknown>;
  try {
    const result = await run(input.params.input ?? {}, { toolCallId: randomUUID(), messages: [] });
    const outcome = isUnknownOutcome(result) ? "outcome_unknown" : isFailedResult(result) ? "failed" : "completed";
    settleTriggerRun(input.deps.runs, input.admitted, outcome);
    return input.params.lifecycle ? { ...input.admitted, result } : result;
  } catch (error) {
    settleTriggerRun(input.deps.runs, input.admitted, "failed", "capability_error", "capability trigger failed");
    throw error;
  }
}

// eslint-disable-next-line max-params
function settleTriggerRun(
  runs: CapabilityTriggerDeps["runs"],
  admitted: TriggerRun | undefined,
  outcome: "completed" | "failed" | "outcome_unknown",
  errorCode?: string,
  summary?: string,
): void {
  if (admitted) runs?.settle(admitted.runId, admitted.attemptId, outcome, { retryable: false, errorCode, summary });
}

function isUnknownOutcome(value: unknown): boolean {
  return typeof value === "object" && value !== null && "state" in value
    && (value as { state?: unknown }).state === "outcome_unknown";
}

function isFailedResult(value: unknown): boolean {
  return typeof value === "object" && value !== null && "ok" in value
    && (value as { ok?: unknown }).ok === false;
}
