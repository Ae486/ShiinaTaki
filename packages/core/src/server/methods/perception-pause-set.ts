/**
 * INPUT:  PerceptionPauseSetParams from a dispatched perception.pauseSet request + the Core PrivacyPause
 * OUTPUT: perceptionPauseSetMethod(pause) -> MethodDefinition (operator-only); pauses/resumes ambient sampling and
 *         echoes the resulting snapshot
 * POS:    core/server/methods — one file per WS method; the ONLY production writer of the pause state (pinned by
 *         privacy-pause-writer.test.ts). Operator-only by the same reasoning as the permission surface: an agent that
 *         could un-pause its own observation would be self-escalating (NL red line §2). NO Rust mirror.
 */
import {
  PERCEPTION_METHODS,
  PerceptionPauseSetParamsSchema,
  type PerceptionPauseSetParams,
  type PerceptionPauseState,
} from "@taki/shared";
import type { PrivacyPause } from "../../perception/privacy-pause.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function perceptionPauseSetMethod(pause: PrivacyPause): MethodDefinition<PerceptionPauseSetParams> {
  return {
    method: PERCEPTION_METHODS.pauseSet,
    roles: ["operator"],
    paramsSchema: PerceptionPauseSetParamsSchema,
    handler: (params): PerceptionPauseState => {
      if (!params.paused) pause.resume();
      // The caller supplies the deadline (Recall's "until tomorrow" is local midnight — a client-side, timezone-aware
      // computation); a null/absent deadline is the manual-resume shape.
      else if (params.until === undefined || params.until === null) pause.pauseUntilResumed();
      else pause.pauseUntil(params.until);
      return pause.state();
    },
  };
}
