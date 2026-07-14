/**
 * INPUT:  MediaGetParams from a dispatched media.get request + an AttachmentStore
 * OUTPUT: mediaGetMethod(store) -> MethodDefinition (operator-only); returns { mediaType, dataBase64 }; a confinement
 *         reject rides the FORBIDDEN app-error envelope, a missing file the generic degradation path
 * POS:    core/server/methods — one file per WS method; a THIN delegation to attachment-store.read (the single-sourced
 *         ref-confinement site, decision 8); operator-only, NO Rust mirror (server-push spec)
 */
import { ErrorCodeSchema, MEDIA_METHODS, MediaGetParamsSchema, type MediaGetParams, type MediaGetResult } from "@taki/shared";
import type { AttachmentStore } from "../../media/attachment-store.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function mediaGetMethod(store: AttachmentStore): MethodDefinition<MediaGetParams> {
  return {
    method: MEDIA_METHODS.get,
    roles: ["operator"], // serving attachment bytes to the chat window is an operator concern
    paramsSchema: MediaGetParamsSchema,
    handler: (params): MediaGetResult => {
      // The whole-ref regex confinement AND the missing-file case both live in read (single-sourced — the security
      // surface is never duplicated). A confinement reject is a semantic REFUSAL → the app-error envelope (FORBIDDEN,
      // the same family as the registry's role gate; error-handling spec). A missing file is ABSENCE, not a refusal —
      // no honest code exists in the closed union, so it rides the registry's generic degradation path (plain throw);
      // both messages are generic so no absolute path is ever leaked.
      const read = store.read(params.ref);
      if (!read.ok) {
        if (read.code === "INVALID_REF") throw appException(ErrorCodeSchema.enum.FORBIDDEN, "invalid attachment ref");
        throw new Error("attachment not found");
      }
      return { mediaType: read.mediaType, dataBase64: read.dataBase64 };
    },
  };
}
