/**
 * INPUT:  per-step SDK response messages and the consumed current step's text
 * OUTPUT: exactly-once completed-step capture plus actual partial text for one canonical turn transaction
 * POS:    core/agents — exception-safe capture; never awaits an unfinished aggregate or manufactures a tool result
 */
import type { ChatActivityAttempt, ChatTurnActivity } from "./chat-activity.ts";
import type { ConversationStore } from "./conversation-store.ts";
import type { TurnMessage } from "./turn-mapping.ts";

export interface TurnRecording {
  capture(stepNumber: number, messages: TurnMessage[]): void;
  observe(part: { type: string; text?: string }): void;
  hasProduced(): boolean;
  commit(input: {
    characterId: string; store: ConversationStore; toolDisplayNames?: Readonly<Record<string, string>>;
    activity?: ChatTurnActivity; attempt?: ChatActivityAttempt;
  }): void;
}

export function createTurnRecording(): TurnRecording {
  const completed = new Map<number, TurnMessage[]>();
  let step = -1;
  let partial = "";
  let committed = false;
  return {
    capture(stepNumber, messages) { if (!completed.has(stepNumber)) completed.set(stepNumber, messages); },
    observe(part) {
      if (part.type === "start-step") step += 1;
      else if (part.type === "text-delta") partial += part.text ?? "";
      else if (part.type === "finish-step") partial = "";
    },
    hasProduced: () => partial.length > 0 || [...completed.values()].some((messages) => messages.length > 0),
    commit(input) {
      if (committed) return;
      const rows = [...completed].sort(([left], [right]) => left - right)
        .flatMap(([stepNumber, messages]) => messages.map((message) => ({ message, stepNumber })));
      // onStepEnd can capture a complete step while the public iterator is paused at an earlier text delta.
      // Its still-buffered partial is already covered by that exact step, even before finish-step is consumed.
      const partialStep = Math.max(step, 0);
      if (partial && !completed.has(partialStep)) rows.push({ message: { role: "assistant", content: partial }, stepNumber: partialStep });
      input.store.commitTurn({
        characterId: input.characterId, messages: rows.map((row) => row.message), toolDisplayNames: input.toolDisplayNames,
        ...(input.activity ? { presentation: {
          messageId: input.activity.messageId, activitySeq: input.activity.seq,
          references: (row, index) => input.attempt?.references(rows[index]?.stepNumber ?? -1, row) ?? [],
        } } : {}),
      });
      committed = true;
    },
  };
}
