/**
 * INPUT: proven native images and their actual user/tool/current-context association
 * OUTPUT: SDK user FilePart messages with transient source identity independent of transport role
 * POS: core/agents — native request projection only; no bytes or transient source facts enter durable rows
 */
import type { ModelMessage } from "ai";
import type { SourceContext, ContextContentOrigin } from "@taki/shared";
import { contextText, retainContextText } from "./context-attribution.ts";

export interface NativeImageData { readonly mediaType: string; readonly dataBase64: string }

export type NativeImageSource =
  | { kind: "tool"; toolCallId: string; toolName: string; originModelEffectId?: string; stepNumber?: number; contextOrigin?: ContextContentOrigin }
  | { kind: "context"; sourceContext?: SourceContext };

const sources = new WeakMap<object, NativeImageSource>();
const currentness = new WeakMap<object, () => boolean>();

export function nativeImageUser(input: {
  text: string; images: readonly NativeImageData[]; source?: NativeImageSource; filename?: string; isCurrent?: () => boolean;
}): ModelMessage {
  const filename = input.filename ?? (input.source?.kind === "tool" ? `taki-tool-image:${JSON.stringify([input.source.originModelEffectId, input.source.stepNumber, input.source.toolCallId, input.source.toolName])}` : undefined);
  const message: ModelMessage = { role: "user", content: [
    ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
    ...input.images.map((image) => ({ type: "file" as const, mediaType: image.mediaType, data: image.dataBase64,
      ...(filename ? { filename } : {}) })),
  ] };
  if (input.source) sources.set(message, input.source);
  if (input.source && input.text) retainContextText(message, contextText(input.text,
    input.source.kind === "tool" ? "tool_interactions" : "runtime_context",
    input.source.kind === "tool" ? input.source.contextOrigin ?? "unknown" : "builtin"));
  if (input.isCurrent) currentness.set(message, input.isCurrent);
  return message;
}

export function nativeImageSource(message: object): NativeImageSource | undefined {
  return sources.get(message);
}

export function retainNativeImageSource(message: object, source: NativeImageSource): void {
  sources.set(message, source);
}

export function nativeImageCurrentness(message: object): (() => boolean) | undefined { return currentness.get(message); }
