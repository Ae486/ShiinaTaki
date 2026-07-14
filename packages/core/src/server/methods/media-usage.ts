/**
 * INPUT:  MediaUsageParams from a dispatched media.usage request + an AttachmentStore + a memory-text-bytes thunk
 * OUTPUT: mediaUsageMethod(store, memoryTextBytes) -> MethodDefinition (operator-only); reports the cache footprint
 * POS:    core/server/methods — one file per WS method; composes attachment usage + memory-text bytes; RESERVED for the
 *         M5 settings UI (D27); operator-only, NO Rust mirror
 */
import { MEDIA_METHODS, MediaUsageParamsSchema, type MediaUsageParams, type MediaUsageResult } from "@taki/shared";
import type { AttachmentStore } from "../../media/attachment-store.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function mediaUsageMethod(store: AttachmentStore, memoryTextBytes: () => number): MethodDefinition<MediaUsageParams> {
  return {
    method: MEDIA_METHODS.usage,
    roles: ["operator"], // a cache-usage query for the settings surface is an operator concern
    paramsSchema: MediaUsageParamsSchema,
    handler: (): MediaUsageResult => {
      const { count, bytes } = store.usage();
      return { attachmentCount: count, attachmentBytes: bytes, memoryTextBytes: memoryTextBytes() };
    },
  };
}
