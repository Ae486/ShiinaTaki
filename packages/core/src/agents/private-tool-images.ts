/**
 * INPUT: completed private SDK rounds with trusted temporary image sidecars and selected canonical rows
 * OUTPUT: Attempt-local native image siblings matched by Run, Attempt, step and exact tool pair
 * POS: core/agents — private replay bridge only; temporary pixels never enter SQLite or a later Attempt
 */
import type { ModelMessage } from "ai";
import type { RunMessage } from "@taki/shared";
import type { CompletedWorkStep } from "./work-context.ts";
import { nativeToolImages, type NativeToolImages } from "./native-tool-images.ts";
import { nativeImageUser } from "./native-image-projection.ts";

export function createPrivateToolImages(runId: string) {
  const captures = new Map<string, { images: NativeToolImages; seq?: number }>();
  return {
    reset() { captures.clear(); },
    capture(step: CompletedWorkStep) {
      for (const message of step.messages) if (message.role === "tool") for (const part of message.content) {
        if (part.type !== "tool-result") continue;
        const images = nativeToolImages(part.output);
        if (images && temporaryImages(images).length) captures.set(key(step, part), { images });
      }
    },
    messages(row: RunMessage): ModelMessage[] {
      if (row.runId !== runId || row.role !== "tool") return [];
      return (row.parts ?? []).flatMap((part) => {
        if (part.type !== "tool-result") return [];
        const capture = captures.get(key(row, part));
        if (!capture) return [];
        capture.seq = row.seq;
        const { images } = capture;
        const temporary = temporaryImages(images);
        const available = images.isCurrent?.() !== false && temporary.length > 0;
        return [nativeImageUser({
          text: `Native evidence for completed tool ${part.toolName}, call ${part.toolCallId}.\n${images.context}`
            + (available ? "" : "\nOriginal image is unavailable (OBSERVATION_RETIRED); do not infer visual details or recapture automatically."),
          images: available ? temporary : [], isCurrent: images.isCurrent,
          filename: `taki-private-tool-image:${JSON.stringify([runId, row.attemptId, row.stepNumber, part.toolCallId, part.toolName])}`,
          source: { kind: "tool", toolCallId: part.toolCallId, toolName: part.toolName,
            originModelEffectId: images.originModelEffectId, stepNumber: row.stepNumber, contextOrigin: part.contextOrigin },
        })];
      });
    },
    retireThrough(throughSeq: number) {
      for (const [identity, capture] of captures) if (capture.seq !== undefined && capture.seq <= throughSeq) {
        capture.images.release?.(); captures.delete(identity);
      }
    },
  };
}

function key(round: { attemptId: string; stepNumber: number }, part: { toolCallId: string; toolName: string }): string {
  return JSON.stringify([round.attemptId, round.stepNumber, part.toolCallId, part.toolName]);
}

function temporaryImages(images: NativeToolImages) {
  return images.images.filter((_image, index) => images.refsByImageIndex ? !images.refsByImageIndex[index] : images.refs.length === 0);
}
