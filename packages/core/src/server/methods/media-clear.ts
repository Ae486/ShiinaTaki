/**
 * INPUT:  MediaClearParams from a dispatched media.clear request + an AttachmentStore
 * OUTPUT: mediaClearMethod(store) -> MethodDefinition (operator-only); purges retained attachment bytes on demand
 * POS:    core/server/methods — one file per WS method; a THIN delegation to attachment-store.clear; operator-only, NO Rust mirror
 */
import { MEDIA_METHODS, MediaClearParamsSchema, type MediaClearParams, type MediaClearResult } from "@taki/shared";
import type { AttachmentStore } from "../../media/attachment-store.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function mediaClearMethod(store: AttachmentStore): MethodDefinition<MediaClearParams> {
  return {
    method: MEDIA_METHODS.clear,
    roles: ["operator"], // purging cached media is an operator action (the description-memory is never touched)
    paramsSchema: MediaClearParamsSchema,
    handler: (): MediaClearResult => store.clear(),
  };
}
