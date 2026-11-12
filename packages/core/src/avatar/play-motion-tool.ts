/**
 * INPUT:  an LLM avatar_play_motion call ({ name, priority?, loop? }) + bound characterId, AvatarSubscriptions, AvatarOutcomes, live vocab
 * OUTPUT: createPlayMotionTool(deps) -> ToolSet { avatar_play_motion }; returns the Presentation Outcome (§3.2 table)
 * POS:    core/avatar — the agent tool; publishes an avatar.command (Core-generated commandId) and awaits the Pet UI's
 *         bounded outcome; execute NEVER throws; no OS/gate (invariant 1/4). Risk posture (MCP vocab, doc-only —
 *         canonical Core governance is authoritative): readOnly (no OS side effect), non-destructive, closed-world.
 */
import { randomUUID } from "node:crypto";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { OUTCOME_GUIDANCE, avatarToolResult } from "./avatar-tool-result.ts";
import type { AvatarToolDeps } from "./avatar-tools.ts";
import { vocabNameSchema } from "./vocab-name-schema.ts";

export function createPlayMotionTool(deps: AvatarToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "avatar" });
  return {
    avatar_play_motion: tool({
      description:
        "Play one of your avatar's body motions to express yourself (e.g. a gesture before acting, or a reaction); " +
        "to change the facial expression instead, use avatar_set_expression. " +
        "The name MUST be one of the motion names listed in your avatar vocabulary. " +
        OUTCOME_GUIDANCE,
      inputSchema: z.object({
        name: vocabNameSchema(deps.vocab?.motions ?? []),
        // Genuine optionals: under AI SDK 7 asSchema, .default() renders input-optional too (not in `required`), so
        // these can't be made strict-ready without forcing a value every turn — strict-ready exemption (see D40).
        priority: z
          .enum(["idle", "normal", "force"])
          .describe("Playback priority; omit for a normal one-shot motion.")
          .optional(),
        loop: z.boolean().describe("Whether the motion repeats; omit for a single play.").optional(),
      }),
      execute: async ({ name, priority, loop }, options) => {
        const { characterId } = deps;
        const commandId = randomUUID();
        try {
          const pending = deps.outcomes.open({ commandId, subscribers: deps.subscriptions.count(characterId), signal: options.abortSignal });
          deps.subscriptions.publish({ characterId, commandId, kind: "motion", name, priority, loop });
          const resolution = await pending;
          log.info({ characterId, name, commandId, toolCallId: options.toolCallId, ...resolution }, "avatar motion settled");
          return avatarToolResult(resolution);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message, commandId }, "avatar play_motion tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
