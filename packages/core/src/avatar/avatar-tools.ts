/**
 * INPUT:  { subscriptions, characterId, logger } — a per-turn characterId binding (like memory.createTools)
 * OUTPUT: createAvatarTools(deps) -> ToolSet { avatar_set_expression, avatar_play_motion }
 * POS:    core/avatar — the avatar tool family combiner (invariant 7 registry); wired into the chat agent per turn
 */
import type { ToolSet } from "ai";
import type { Logger } from "../logging/logger.ts";
import type { AvatarSubscriptions } from "./avatar-subscriptions.ts";
import { createPlayMotionTool } from "./play-motion-tool.ts";
import { createSetExpressionTool } from "./set-expression-tool.ts";

export interface AvatarToolDeps {
  subscriptions: AvatarSubscriptions;
  /** The turn's character; publishes ride to this character's subscribers (bound per turn, not at boot). */
  characterId: string;
  logger: Logger;
}

export function createAvatarTools(deps: AvatarToolDeps): ToolSet {
  return {
    ...createSetExpressionTool(deps),
    ...createPlayMotionTool(deps),
  };
}
