/**
 * INPUT:  an LLM avatar_set_expression call ({ name }) + bound characterId, AvatarSubscriptions, and live vocab (name enum, 1e)
 * OUTPUT: createSetExpressionTool(deps) -> ToolSet { avatar_set_expression }; returns { ok:true } (fire-and-forget)
 * POS:    core/avatar — the agent tool; publishes an avatar.command to the Pet UI; execute NEVER throws; no OS/gate (invariant 1/4)
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AvatarToolDeps } from "./avatar-tools.ts";
import { vocabNameSchema } from "./vocab-name-schema.ts";

export function createSetExpressionTool(deps: AvatarToolDeps): ToolSet {
  const log = deps.logger.child({ mod: "avatar" });
  return {
    avatar_set_expression: tool({
      description:
        "Set your avatar's facial expression to show how you feel (e.g. before replying, or reacting to the user). " +
        "The name MUST be one of the expression names listed in your avatar vocabulary; an unknown name is ignored. " +
        "Fire-and-forget: it changes what the user sees on screen — there is no result to read, and it is fine if no " +
        "avatar is currently shown. After calling it, add a follow-up message only if you have new substantive " +
        "content to say — never filler.",
      inputSchema: z.object({ name: vocabNameSchema(deps.vocab?.expressions ?? []) }),
      // Publishing is a synchronous fan-out that never blocks the turn; execute still degrades any failure to a
      // structured result the model can read (error-handling spec) rather than throwing.
      execute: async ({ name }) => {
        try {
          deps.subscriptions.publish({ characterId: deps.characterId, kind: "expression", name });
          log.info({ characterId: deps.characterId, name }, "avatar expression published");
          return { ok: true as const };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn({ err: message }, "avatar set_expression tool failed");
          return { ok: false as const, code: "INTERNAL_ERROR", message };
        }
      },
    }),
  };
}
