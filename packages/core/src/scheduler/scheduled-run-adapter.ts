/**
 * INPUT: claimed Scheduled Task occurrences, RunService, ChatAgent, and shared Character turn controls
 * OUTPUT: exactly one non-primary ChatAgent execution through the canonical Run lifecycle
 * POS: core/scheduler - trigger adapter only; no independent model loop, queue, Run store, or recovery authority
 */
import { createHash } from "node:crypto";
import { TriggerRequestSchema } from "@taki/shared";
import type { ChatAgent } from "../agents/chat-agent.ts";
import type { TurnQueue } from "../agents/turn-queue.ts";
import type { TurnRegistry } from "../agents/turn-registry.ts";
import type { ScheduledTaskRepo, ScheduleOccurrence } from "../db/scheduled-task-repo.ts";
import type { RunService } from "../harness/run-service.ts";
import type { Logger } from "../logging/logger.ts";

export interface ScheduledRunAdapter { dispatch(taskId: string, occurrence: ScheduleOccurrence): Promise<string>; reconcile(): void; }
export function createScheduledRunAdapter(input: { repo: ScheduledTaskRepo; runs: RunService; agent: ChatAgent; queue: TurnQueue; turns: TurnRegistry; logger: Logger;
  deliver?: (result: { runId: string; attemptId: string; characterId: string; text: string; signal?: AbortSignal }) => Promise<void> }): ScheduledRunAdapter {
  const terminal = new Set(["completed", "failed", "cancelled", "skipped", "deadline_exceeded", "outcome_unknown"]);
  return {
    async dispatch(taskId, occurrence) {
      const task = input.repo.get(taskId);
      if (!task || task.state === "deleted" || !occurrence.characterId || !occurrence.controlInput) {
        input.repo.settleOccurrence({ taskId, scheduledFor: occurrence.scheduledFor, state: "missed" });
        return "";
      }
      const requestId = occurrenceKey(taskId, occurrence.scheduledFor);
      const request = TriggerRequestSchema.parse({ triggerRequestId: requestId, idempotencyKey: requestId, characterId: occurrence.characterId, initiator: "scheduled", provenance: { provider: "scheduled-task", taskId }, deliveryClass: "class_a", contextMode: "autonomous" });
      const admitted = await input.runs.admit(request); const runId = admitted.run.runId; let attemptId = admitted.attempt.attemptId;
      input.repo.linkOccurrence({ taskId, scheduledFor: occurrence.scheduledFor, runId });
      if (terminal.has(admitted.run.state)) { input.repo.settleOccurrence({ taskId, scheduledFor: occurrence.scheduledFor, state: "terminal" }); return runId; }
      const release = await input.queue.acquire(occurrence.characterId); const controller = input.turns.begin(occurrence.characterId, undefined, runId);
      try {
        if (!input.runs.start(runId, attemptId)) return runId;
        let text = "";
        const turn = { turnKind: "non-primary" as const, controlInput: occurrence.controlInput, runId, attemptId, signal: controller.signal, runContext: input.runs.context(runId), onSettledText: (value: string) => { text = value; }, onRetry: (reason: string) => { const next = input.runs.retry(runId, attemptId, reason); const replacement = next.run.activeAttemptId; if (!replacement || replacement === attemptId) return false; attemptId = replacement; turn.attemptId = replacement; return true; } };
        for await (const delta of input.agent.stream({ characterId: occurrence.characterId, message: "Scheduled Task" }, turn)) { void delta; }
        if (!controller.signal.aborted && text.trim() && input.deliver) await input.deliver({ runId, attemptId, characterId: occurrence.characterId, text, signal: controller.signal });
        else input.runs.settle(runId, attemptId, controller.signal.aborted ? "cancelled" : "completed", { retryable: false });
      } catch {
        input.runs.settle(runId, attemptId, controller.signal.aborted ? "cancelled" : "failed", { retryable: false, summary: "Scheduled Agent turn failed", errorCode: "scheduled_agent_error" });
        input.logger.warn({ taskId, runId, errorCode: "scheduled_agent_error" }, "scheduled run failed");
      } finally { input.turns.end(occurrence.characterId, controller); release(); }
      input.repo.settleOccurrence({ taskId, scheduledFor: occurrence.scheduledFor, state: "terminal" });
      input.repo.advance({ taskId, lastRunId: runId }); return runId;
    },
    reconcile() { for (const occurrence of input.repo.unsettled()) { if (!occurrence.runId) continue; const status = input.runs.status(occurrence.runId); if (terminal.has(status.run.state)) input.repo.settleOccurrence({ taskId: occurrence.taskId, scheduledFor: occurrence.scheduledFor, state: "terminal" }); } },
  };
}
function occurrenceKey(taskId: string, scheduledFor: string): string { return `scheduled:${createHash("sha256").update(`${taskId}\n${scheduledFor}`).digest("hex")}`; }
