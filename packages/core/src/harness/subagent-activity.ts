/**
 * INPUT: real child SDK/activity events and durably completed private step boundaries
 * OUTPUT: isolated child live notifications and bounded recoverable snapshots
 * POS: core/harness — disposable selected-conversation projection; no main/Pet or Timeline publication
 */
import type { SubagentActivity, SubagentActivityReadResult } from "@taki/shared";
import { createChatTurnActivity, type ChatTurnActivity } from "../agents/chat-activity.ts";
import { createChatActivityProjection, type ChatActivityProjection } from "../agents/chat-activity-projection.ts";
import type { Database } from "../db/sqlite.ts";
import { createRunMessageRepo } from "../db/run-message-repo.ts";
import type { ChatActivityAttempt } from "../agents/chat-activity.ts";

interface ChildActivity {
  characterId: string; workInputId: string; runId: string; projection: ChatActivityProjection;
  coveredThroughStep: number; stepNumber: number; itemSteps: Map<string, number>;
}

export function createSubagentActivity(db: Database, changed: (characterId: string, subagentId: string) => void) {
  const children = new Map<string, ChildActivity>();
  const sinks = new Set<(event: SubagentActivity) => void>();
  return {
    start(input: { characterId: string; subagentId: string; workInputId: string; runId: string }): ChatTurnActivity {
      children.get(input.subagentId)?.projection.dispose();
      const value: ChildActivity = { ...input, projection: createChatActivityProjection(),
        coveredThroughStep: -1, stepNumber: -1, itemSteps: new Map() };
      children.set(input.subagentId, value);
      const identity = { characterId: input.characterId, messageId: input.runId, runId: input.runId };
      value.projection.start(identity);
      const activity = createChatTurnActivity({ identity, publish(event) {
        if (children.get(input.subagentId) !== value || !value.projection.apply(event)) return;
        if ("itemId" in event && !value.itemSteps.has(event.itemId) && value.itemSteps.size < 512) value.itemSteps.set(event.itemId, Math.max(0, value.stepNumber));
        const notification = { subagentId: input.subagentId, workInputId: input.workInputId, activity: event };
        for (const sink of sinks) {
          try { sink(notification); } catch { /* Presentation listeners never change child execution. */ }
        }
      } });
      return { ...activity, get seq() { return activity.seq; }, beginAttempt(attemptId) {
        value.stepNumber = -1; value.coveredThroughStep = -1;
        const attempt = activity.beginAttempt(attemptId);
        return { ...attempt, observe(part, invocations) {
          if (typeof part === "object" && part !== null && "type" in part && part.type === "start-step") value.stepNumber++;
          attempt.observe(part, invocations);
          if (typeof part === "object" && part !== null && "type" in part && part.type === "finish-step" && attemptId) {
            retainPresentation(db, { runId: input.runId, attemptId, stepNumber: value.stepNumber, activity: attempt });
            value.coveredThroughStep = Math.max(value.coveredThroughStep, value.stepNumber);
            db.afterCommit(() => changed(input.characterId, input.subagentId));
          }
        } };
      } };
    },
    committed(input: { subagentId: string; runId: string; stepNumber: number }) {
      const value = children.get(input.subagentId);
      if (value?.runId === input.runId) value.coveredThroughStep = Math.max(value.coveredThroughStep, input.stepNumber);
    },
    read(input: { characterId: string; subagentId: string }): SubagentActivityReadResult {
      const value = children.get(input.subagentId);
      if (!value) return { subagentId: input.subagentId, workInputId: null, activity: { status: "idle", characterId: input.characterId },
        coveredThroughStep: -1, itemSteps: [] };
      if (value.characterId !== input.characterId) throw new Error("SUBAGENT_CHARACTER_MISMATCH");
      return { subagentId: input.subagentId, workInputId: value.workInputId, activity: value.projection.read(input.characterId),
        coveredThroughStep: value.coveredThroughStep, itemSteps: [...value.itemSteps].map(([itemId, stepNumber]) => ({ itemId, stepNumber })) };
    },
    subscribe(sink: (event: SubagentActivity) => void) { sinks.add(sink); return () => { sinks.delete(sink); }; },
    close() { for (const value of children.values()) value.projection.dispose(); children.clear(); sinks.clear(); },
  };
}
export type SubagentActivityStore = ReturnType<typeof createSubagentActivity>;

function retainPresentation(db: Database, input: { runId: string; attemptId: string; stepNumber: number; activity: ChatActivityAttempt }): void {
  const rows = db.prepare(`SELECT seq FROM run_messages WHERE run_id=:run AND attempt_id=:attempt
    AND step_number=:step AND entry_kind='output' ORDER BY seq`)
    .all({ run: input.runId, attempt: input.attemptId, step: input.stepNumber });
  db.transaction(() => {
    for (const row of rows) {
      const message = createRunMessageRepo(db).list({ runId: input.runId, afterSeq: Number(row.seq) - 1, limit: 1 })[0];
      if (!message) throw new Error("SUBAGENT_HISTORY_SOURCE_UNAVAILABLE");
      const references = input.activity.references(input.stepNumber, message);
      db.prepare("INSERT OR IGNORE INTO subagent_message_presentation(message_seq,references_json) VALUES(:seq,:refs)")
        .run({ seq: message.seq, refs: JSON.stringify(references) });
    }
  });
}
