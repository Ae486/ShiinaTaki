/**
 * INPUT:  an LLM avatar_set_expression call ({ name }) + bound characterId, AvatarSubscriptions, AvatarOutcomes, live vocab
 * OUTPUT: createSetExpressionTool(deps) -> ToolSet { avatar_set_expression }; returns the Presentation Outcome (§3.2 table)
 * POS:    core/avatar — the agent tool; publishes an avatar.command (Core-generated commandId) and awaits the Pet UI's
 *         bounded outcome; execute NEVER throws; no OS/gate (invariant 1/4). Risk posture (MCP vocab, doc-only —
 *         canonical Core governance is authoritative): readOnly (no OS side effect), non-destructive, idempotent, closed-world.
 */
import { randomUUID } from "node:crypto";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { OUTCOME_GUIDANCE, avatarToolResult } from "./avatar-tool-result.ts";
import type { AvatarToolDeps } from "./avatar-tools.ts";
import { vocabNameSchema } from "./vocab-name-schema.ts";

export function createSetExpressionTool(deps: AvatarToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "avatar" });
  return {
    avatar_set_expression: tool({
      description:
        "Set your avatar's facial expression alongside your reply or reaction to the user; " +
        "to play a body motion instead, use avatar_play_motion. " +
        "The name MUST be one of the expression names listed in your avatar vocabulary. " +
        OUTCOME_GUIDANCE,
      inputSchema: z.object({ name: vocabNameSchema(deps.vocab?.expressions ?? []) }),
      // Publish is synchronous fan-out; the wait is bounded by the outcomes registry (deadline / abort / no subscriber)
      // so the turn never blocks on a Pet UI. Any failure degrades to a structured result the model can read.
      execute: async ({ name }, options) => {
        const { characterId } = deps;
        const commandId = randomUUID();
        try {
          const pending = deps.outcomes.open({ commandId, subscribers: deps.subscriptions.count(characterId), signal: options.abortSignal });
          deps.subscriptions.publish({ characterId, commandId, kind: "expression", name });
          const resolution = await pending;
          log.info({ characterId, name, commandId, toolCallId: options.toolCallId, ...resolution }, "avatar expression settled");
          return avatarToolResult(resolution);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message, commandId }, "avatar set_expression tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
