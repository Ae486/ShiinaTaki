/**
 * INPUT: actual completed SDK tool results carrying trusted capture sidecars and the current step messages
 * OUTPUT: idempotent native image siblings beside faithful tool feedback with exact call/name associations
 * POS: core/agents — Attempt-local tool continuation; no JSON inference, tool execution or duplicate capture
 */
import type { ModelMessage } from "ai";
import { nativeToolImages, withNativeToolImages, type NativeToolImages } from "./native-tool-images.ts";
import { nativeImageUser } from "./native-image-projection.ts";
import { RETAINED_IMAGE_FILENAME_PREFIX } from "./native-image-replay.ts";
import { contentOrigin } from "./context-attribution.ts";

export function createNativeToolProjection() {
  const completed = new Set<NativeToolImages>();
  const projected = new WeakSet<object>();
  return {
    capture(input: { results: readonly { toolCallId: string; toolName: string; output: unknown }[];
      messages: ModelMessage[]; originModelEffectId?: string; stepNumber: number }) {
      for (const message of input.messages) if (message.role === "tool") for (const part of message.content) {
        if (part.type !== "tool-result") continue;
        const result = input.results.find((item) => item.toolCallId === part.toolCallId && item.toolName === part.toolName);
        const images = nativeToolImages(result?.output);
        if (!images) continue;
        completed.add(images);
        images.originModelEffectId = input.originModelEffectId;
        images.stepNumber = input.stepNumber;
        withNativeToolImages(part.output, images);
      }
    },
    render(messages: ModelMessage[]): ModelMessage[] {
      return messages.filter((message) => !projected.has(message)).flatMap((message) => {
        if (message.role !== "tool") return [message];
        const imageMessages = message.content.flatMap((part) => {
          if (part.type !== "tool-result") return [];
          const images = nativeToolImages(part.output);
          if (!images) return [];
          const available = images.isCurrent?.() !== false;
          const native = nativeImageUser({ text: `Native evidence for completed tool ${part.toolName}, call ${part.toolCallId}.\n${images.context}${available ? "" : "\nOriginal image is unavailable (OBSERVATION_RETIRED); do not infer visual details or recapture automatically."}`,
            images: available ? images.images : [], isCurrent: images.isCurrent,
            source: { kind: "tool", toolCallId: part.toolCallId, toolName: part.toolName,
              originModelEffectId: images.originModelEffectId, stepNumber: images.stepNumber,
              contextOrigin: contentOrigin(part) ?? contentOrigin(part.output) } });
          if (native.role === "user" && Array.isArray(native.content)) {
            let index = 0;
            for (const file of native.content) if (file.type === "file") {
              const ref = images.refsByImageIndex ? images.refsByImageIndex[index++] : images.refs[index++];
              if (ref) file.filename = `${RETAINED_IMAGE_FILENAME_PREFIX}${ref.ref}|${JSON.stringify([images.originModelEffectId, images.stepNumber, part.toolCallId, part.toolName])}`;
            }
          }
          projected.add(native);
          return [native];
        });
        return [message, ...imageMessages];
      });
    },
    release() { for (const evidence of completed) evidence.release?.(); completed.clear(); },
  };
}
