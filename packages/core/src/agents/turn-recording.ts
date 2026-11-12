/**
 * INPUT:  per-step SDK response messages and the consumed current step's text
 * OUTPUT: exactly-once step capture, durable private-frontier release and uncovered partial text
 * POS:    core/agents — exception-safe capture; never awaits an unfinished aggregate or manufactures a tool result
 */
/* eslint max-lines-per-function: ["error", { "max": 60, "skipBlankLines": true, "skipComments": true }] -- One capture owner keeps the released frontier, retry evidence and buffered partial text consistent. */
import type { SourceContext, TimelineEntry } from "@taki/shared";
import type { ChatActivityAttempt, ChatTurnActivity } from "./chat-activity.ts";
import type { ConversationStore } from "./conversation-store.ts";
import type { TurnMessage } from "./turn-mapping.ts";

export interface TurnRecording {
  capture(stepNumber: number, messages: TurnMessage[], sourceContext?: SourceContext): void;
  /** The private transcript owner must have durably checkpointed this complete frontier first. */
  releaseThrough(stepNumber: number): void;
  observe(part: { type: string; text?: string }): void;
  hasProduced(): boolean;
  partial(): { stepNumber: number; text: string } | undefined;
  commit(input: {
    characterId: string; store: ConversationStore; toolDisplayNames?: Readonly<Record<string, string>>;
    primarySourceId?: string;
    activity?: ChatTurnActivity; attempt?: ChatActivityAttempt;
    partialSourceContext?: SourceContext;
  }): TimelineEntry[];
}

export function createTurnRecording(): TurnRecording {
  const completed = new Map<number, TurnMessage[]>();
  const sources = new Map<number, SourceContext>();
  let step = -1;
  let partial = "";
  let committed = false;
  let releasedThrough = -1;
  let completedOutput = false;
  return {
    capture(stepNumber, messages, sourceContext) {
      if (stepNumber <= releasedThrough || completed.has(stepNumber)) return;
      completed.set(stepNumber, messages);
      completedOutput ||= messages.length > 0;
      if (sourceContext) sources.set(stepNumber, sourceContext);
    },
    releaseThrough(stepNumber) {
      if (stepNumber <= releasedThrough) return;
      if (!Number.isSafeInteger(stepNumber) || !completed.has(stepNumber)) throw new Error("TURN_RECORDING_FRONTIER_NOT_COMPLETED");
      for (const recordedStep of completed.keys()) {
        if (recordedStep <= stepNumber) { completed.delete(recordedStep); sources.delete(recordedStep); }
      }
      releasedThrough = stepNumber;
    },
    observe(part) {
      if (part.type === "start-step") step += 1;
      else if (part.type === "text-delta") partial += part.text ?? "";
      else if (part.type === "finish-step") partial = "";
    },
    hasProduced: () => partial.length > 0 || completedOutput,
    partial: () => partial && Math.max(step, 0) > releasedThrough && !completed.has(Math.max(step, 0))
      ? { stepNumber: Math.max(step, 0), text: partial } : undefined,
    commit(input) {
      if (committed) return [];
      const rows = [...completed].sort(([left], [right]) => left - right)
        .flatMap(([stepNumber, messages]) => messages.map((message) => ({ message, stepNumber })));
      // onStepEnd can capture a complete step while the public iterator is paused at an earlier text delta.
      // Its still-buffered partial is already covered by that exact step, even before finish-step is consumed.
      const partialStep = Math.max(step, 0);
      if (partial && partialStep > releasedThrough && !completed.has(partialStep)) {
        rows.push({ message: { role: "assistant", content: partial }, stepNumber: partialStep });
      }
      const entries = input.store.commitTurn({
        characterId: input.characterId, primarySourceId: input.primarySourceId,
        messages: rows.map((row) => row.message), toolDisplayNames: input.toolDisplayNames,
        sourceContext: (index) => sources.get(rows[index]?.stepNumber ?? -1)
          ?? (rows[index]?.stepNumber === partialStep && !completed.has(partialStep) ? input.partialSourceContext : undefined),
        ...(input.activity ? { presentation: {
          messageId: input.activity.messageId, activitySeq: input.activity.seq,
          references: (row, index) => input.attempt?.references(rows[index]?.stepNumber ?? -1, row) ?? [],
        } } : {}),
      });
      committed = true;
      return entries;
    },
  };
}
