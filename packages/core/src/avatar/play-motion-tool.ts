/**
 * INPUT:  an LLM avatar_play_motion call ({ name, priority?, loop? }) + bound characterId, AvatarSubscriptions, live vocab (name enum, 1e)
 * OUTPUT: createPlayMotionTool(deps) -> ToolSet { avatar_play_motion }; returns { ok:true } (fire-and-forget)
 * POS:    core/avatar — the agent tool; publishes an avatar.command to the Pet UI; execute NEVER throws; no OS/gate (invariant 1/4).
 *         Risk posture (MCP vocab, doc-only — canonical Core governance is authoritative; an Execution Host may only
 *         tighten and finally enforce Host-local actions): readOnly (no OS side effect), non-destructive, closed-world.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AvatarToolDeps } from "./avatar-tools.ts";
import { vocabNameSchema } from "./vocab-name-schema.ts";

export function createPlayMotionTool(deps: AvatarToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "avatar" });
  return {
    avatar_play_motion: tool({
      description:
        "Play one of your avatar's body motions to express yourself (e.g. a gesture before acting, or a reaction); " +
        "to change the facial expression instead, use avatar_set_expression. " +
        "The name MUST be one of the motion names listed in your avatar vocabulary; an unknown name is ignored. " +
        "Fire-and-forget: it animates what the user sees on screen — there is no result to read, and it is fine if no " +
        "avatar is currently shown. After calling it, add a follow-up message only if you have new substantive " +
        "content to say — never filler.",
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
      execute: async ({ name, priority, loop }) => {
        try {
          deps.subscriptions.publish({ characterId: deps.characterId, kind: "motion", name, priority, loop });
          log.info({ characterId: deps.characterId, name }, "avatar motion published");
          return { ok: true as const };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "avatar play_motion tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
