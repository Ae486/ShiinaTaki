/**
 * INPUT:  an LLM avatar_play_motion call ({ name, priority?, loop? }) + a bound characterId and AvatarSubscriptions
 * OUTPUT: createPlayMotionTool(deps) -> ToolSet { avatar_play_motion }; returns { ok:true } (fire-and-forget)
 * POS:    core/avatar — the agent tool; publishes an avatar.command to the Pet UI; execute NEVER throws; no OS/gate (invariant 1/4)
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AvatarToolDeps } from "./avatar-tools.ts";

export function createPlayMotionTool(deps: AvatarToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "avatar" });
  return {
    avatar_play_motion: tool({
      description:
        "Play one of your avatar's body motions to express yourself (e.g. a gesture before acting, or a reaction). " +
        "The name MUST be one of the motion names listed in your avatar vocabulary; an unknown name is ignored. " +
        "Fire-and-forget: it animates what the user sees on screen — there is no result to read, and it is fine if no " +
        "avatar is currently shown.",
      inputSchema: z.object({
        name: z.string().min(1),
        // Optional engine knobs the Pet UI passes through to model.motion(); omit for a normal one-shot motion.
        priority: z.enum(["idle", "normal", "force"]).optional(),
        loop: z.boolean().optional(),
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
