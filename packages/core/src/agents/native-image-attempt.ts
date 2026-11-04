/**
 * INPUT: transient observation lease, selected retained-image reader and exact provider dispatch params
 * OUTPUT: native context projection plus last-moment stale/expired image removal and actual-envelope capture
 * POS: core/agents — Attempt-owned image lifetime and provider boundary; never captures or translates an image
 */
import { randomUUID } from "node:crypto";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware, type ModelMessage } from "ai";
import type { NativeImageContext } from "./native-image-context.ts";
import { nativeImageCurrentness, nativeImageSource, nativeImageUser, retainNativeImageSource, type NativeImageSource } from "./native-image-projection.ts";
import { RETAINED_IMAGE_FILENAME_PREFIX, type ImageReplayReader } from "./native-image-replay.ts";
import { renderSourceContext } from "./source-context.ts";
import { describeMessages, type RequestDescriptors } from "./request-composition.ts";
import type { ContextContentOrigin } from "@taki/shared";

type DispatchParams = Parameters<NonNullable<LanguageModelMiddleware["wrapStream"]>>[0]["params"];
export interface NativeDispatchInput { instructions: string; outgoing: ModelMessage[]; preparedTools: ReadonlyArray<Record<string, unknown>> }

export function createNativeImageAttempt(input: {
  context?: NativeImageContext; attachments?: ImageReplayReader;
  onDispatch: (request: NativeDispatchInput, descriptors: Pick<RequestDescriptors, "texts" | "interactions">) => void;
  interactionOrigin?: (part: { toolCallId: string; toolName: string }) => ContextContentOrigin | undefined;
}) {
  const filename = `taki-current-image:${randomUUID()}`;
  const origins = new Map<string, NativeImageSource>();
  const currentness = new Map<string, () => boolean>();
  let descriptors = describeMessages([]);
  return {
    project(messages: ModelMessage[]): ModelMessage[] {
      const original = messages.filter((message) => !isContextMessage(message, filename));
      const projected = !input.context?.isCurrent() || !input.context.images.length ? original
        : [...original, nativeImageUser({ text: [input.context.context, renderSourceContext(input.context.sourceContext)].filter(Boolean).join("\n"),
          images: input.context.images, filename, source: { kind: "context", sourceContext: input.context.sourceContext } })];
      for (const message of projected) {
        const source = nativeImageSource(message);
        if (source && Array.isArray(message.content)) for (const part of message.content) {
          if (part.type === "file" && part.filename) origins.set(part.filename, source);
          const isCurrent = nativeImageCurrentness(message);
          if (part.type === "file" && part.filename && isCurrent) currentness.set(part.filename, isCurrent);
        }
      }
      descriptors = describeMessages(projected, input.interactionOrigin);
      return projected;
    },
    model(model: LanguageModel): LanguageModel {
      const dispatch = (params: DispatchParams) => {
        // This runs synchronously immediately before the delegate's doStream/doGenerate, after Effect intent.
        // Optional observation retirement removes that observation; valid text/tool work still dispatches.
        params.prompt = params.prompt.filter((message) => input.context?.isCurrent() || !isContextMessage(message, filename))
          .map((message) => {
            const source = message.role === "user" ? message.content.flatMap((part) => {
              const origin = part.type === "file" && part.filename ? origins.get(part.filename) : undefined;
              return origin ? [origin] : [];
            })[0] : undefined;
            const refreshed = refreshRetainedMessage(removeRetiredToolImages(message, currentness), input.attachments);
            if (source) retainNativeImageSource(refreshed, source);
            return refreshed;
          });
        observeNativeDispatch(params, descriptors, input.onDispatch);
      };
      return wrapLanguageModel({ model: model as Parameters<typeof wrapLanguageModel>[0]["model"], middleware: {
        specificationVersion: "v4",
        wrapStream({ doStream, params }) { dispatch(params); return doStream(); },
        wrapGenerate({ doGenerate, params }) { dispatch(params); return doGenerate(); },
      } });
    },
  };
}

function observeNativeDispatch(params: DispatchParams, descriptors: Pick<RequestDescriptors, "texts" | "interactions">,
  observe: (request: NativeDispatchInput, descriptors: Pick<RequestDescriptors, "texts" | "interactions">) => void): void {
  try { observe({ instructions: params.prompt.filter((message) => message.role === "system").map((message) => message.content).join("\n\n"),
    // The estimator consumes role/type/text/tool fields; native V4 file data remains a real file part.
    outgoing: params.prompt.filter((message) => message.role !== "system") as unknown as ModelMessage[],
    preparedTools: (params.tools ?? []) as unknown as ReadonlyArray<Record<string, unknown>> }, descriptors);
  } catch { /* Optional dispatch observers cannot prevent the valid native provider operation. */ }
}

function removeRetiredToolImages(message: DispatchParams["prompt"][number], currentness: Map<string, () => boolean>): DispatchParams["prompt"][number] {
  if (message.role !== "user") return message;
  return { ...message, content: message.content.map((part) => part.type === "file" && part.filename && currentness.get(part.filename)?.() === false
    ? { type: "text" as const, text: "Original image is unavailable (OBSERVATION_RETIRED); do not infer its contents or recapture automatically." } : part) };
}

function isContextMessage(message: { role: string; content: unknown }, filename: string): boolean {
  return message.role === "user" && Array.isArray(message.content) && message.content.some((part: unknown) =>
    typeof part === "object" && part !== null && "type" in part && part.type === "file" && "filename" in part && part.filename === filename);
}

function refreshRetainedMessage(message: DispatchParams["prompt"][number], reader?: ImageReplayReader): DispatchParams["prompt"][number] {
  if (message.role !== "user" || !reader) return message;
  return { ...message, content: message.content.map((part) => {
    if (part.type !== "file" || !part.filename?.startsWith(RETAINED_IMAGE_FILENAME_PREFIX)) return part;
    const ref = part.filename.slice(RETAINED_IMAGE_FILENAME_PREFIX.length).split("|", 1)[0] ?? "";
    const result = reader.read(ref);
    return result.ok && result.mediaType === part.mediaType ? { ...part, data: { type: "data" as const, data: Buffer.from(result.dataBase64, "base64") } }
      : { type: "text" as const, text: `Original image ${ref} is unavailable (${result.ok ? "MEDIA_TYPE_MISMATCH" : result.code}). Do not infer its visual contents or recapture it automatically.` };
  }) };
}
