/**
 * INPUT:  candidate chat.* params/event payloads
 * OUTPUT: CHAT_METHODS + ChatSend/Cancel/Delta/Complete/Error schemas + ImageAttachment (in-flight image input, #17)
 * POS:    shared/protocol — the chat conversation contract (invariants 3, 7); consumed by core server + CLI
 */
import { z } from "zod";
import { ErrorCodeSchema } from "./error-code-schema.ts";

export const CHAT_METHODS = {
  send: "chat.send",
  cancel: "chat.cancel",
  delta: "chat.delta",
  complete: "chat.complete",
  error: "chat.error",
} as const;

// The image formats a turn may attach; the vision slot receives them as AI SDK file parts (#17 decision 5).
// timeline-schema imports this const for its image part variant (single source, never redeclared).
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

// Per-message attachment cap (R3): keeps a send bounded; the UI downscales oversize sources before they arrive here.
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;

// One in-flight attachment: raw base64 (NO `data:` prefix — a tagged data-URL throws in ai@7, research r1) + its type.
export const ImageAttachmentSchema = z.object({
  mediaType: z.enum(IMAGE_MEDIA_TYPES),
  dataBase64: z.string().min(1),
});
export type ImageAttachment = z.infer<typeof ImageAttachmentSchema>;

export const ChatSendParamsSchema = z
  .object({
    characterId: z.string().min(1),
    // Relaxed from min(1): an empty caption is legitimate alongside an image. Text-only sends parse as before —
    // the refine below still rejects a wholly empty send (empty message AND no attachments).
    message: z.string(),
    attachments: z.array(ImageAttachmentSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
  })
  .refine((params) => params.message.length > 0 || (params.attachments?.length ?? 0) > 0, {
    message: "a chat.send must carry a non-empty message or at least one attachment",
  });
export type ChatSendParams = z.infer<typeof ChatSendParamsSchema>;

export const ChatSendResultSchema = z.object({
  messageId: z.string(),
});
export type ChatSendResult = z.infer<typeof ChatSendResultSchema>;

// Cancel the in-flight turn for a character (new message arriving, UI close). Idempotent: no active turn = cancelled:false.
export const ChatCancelParamsSchema = z.object({
  characterId: z.string().min(1),
});
export type ChatCancelParams = z.infer<typeof ChatCancelParamsSchema>;

export const ChatCancelResultSchema = z.object({
  cancelled: z.boolean(),
});
export type ChatCancelResult = z.infer<typeof ChatCancelResultSchema>;

export const ChatDeltaSchema = z.object({
  messageId: z.string(),
  characterId: z.string(),
  delta: z.string(),
});
export type ChatDelta = z.infer<typeof ChatDeltaSchema>;

export const ChatCompleteSchema = z.object({
  messageId: z.string(),
  characterId: z.string(),
});
export type ChatComplete = z.infer<typeof ChatCompleteSchema>;

export const ChatErrorSchema = z.object({
  messageId: z.string(),
  characterId: z.string(),
  code: ErrorCodeSchema,
  message: z.string(),
  // Cancel-retract (M4 closeout): true only when the turn was cancelled before it produced anything — its user row
  // was deleted (timeline.removed pushed) and the draft returns to the composer. Absent on every other error.
  retracted: z.boolean().optional(),
});
export type ChatError = z.infer<typeof ChatErrorSchema>;
