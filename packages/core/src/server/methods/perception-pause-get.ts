/**
 * INPUT:  PerceptionPauseGetParams from a dispatched perception.pauseGet request + the Core PrivacyPause
 * OUTPUT: perceptionPauseGetMethod(pause) -> MethodDefinition (operator-only); the current pause snapshot
 * POS:    core/server/methods — one file per WS method; a THIN read of privacy-pause.state (a lapsed deadline
 *         self-resumes on this read); operator-only, NO Rust mirror
 */
import {
  PERCEPTION_METHODS,
  PerceptionPauseGetParamsSchema,
  type PerceptionPauseGetParams,
  type PerceptionPauseState,
} from "@taki/shared";
import type { PrivacyPause } from "../../perception/privacy-pause.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function perceptionPauseGetMethod(pause: PrivacyPause): MethodDefinition<PerceptionPauseGetParams> {
  return {
    method: PERCEPTION_METHODS.pauseGet,
    roles: ["operator"], // reading whether observation is suspended is a settings-surface concern, not an agent one
    paramsSchema: PerceptionPauseGetParamsSchema,
    handler: (): PerceptionPauseState => pause.state(),
  };
}
