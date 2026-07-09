/**
 * INPUT:  candidate chat.* params/event payloads
 * OUTPUT: CHAT_METHODS names + ChatSend/Delta/Complete/Error schemas (characterId on every frame)
 * POS:    shared/protocol — the chat conversation contract (invariants 3, 7); consumed by core server + CLI
 */
import { z } from "zod";
import { ErrorCodeSchema } from "./error-code-schema.ts";

export const CHAT_METHODS = {
  send: "chat.send",
  delta: "chat.delta",
  complete: "chat.complete",
  error: "chat.error",
} as const;

export const ChatSendParamsSchema = z.object({
  characterId: z.string().min(1),
  message: z.string().min(1),
});
export type ChatSendParams = z.infer<typeof ChatSendParamsSchema>;

export const ChatSendResultSchema = z.object({
  messageId: z.string(),
});
export type ChatSendResult = z.infer<typeof ChatSendResultSchema>;

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
});
export type ChatError = z.infer<typeof ChatErrorSchema>;
