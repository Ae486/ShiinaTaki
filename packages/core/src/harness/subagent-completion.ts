/**
 * INPUT: durable pending child results and post-commit/Character-release hints
 * OUTPUT: at most one linked parent admission per completion plus separately staged replies
 * POS: core/harness — completion outbox consumer; no second scheduler, Timeline writer or publication authority
 */
import { randomUUID } from "node:crypto";
import type { SubagentResultGroup } from "@taki/shared";
import { executeParentContinuation } from "./subagent-parent-execution.ts";
import { checkWorkCurrent, type BoundSubagentWork, type SubagentState } from "./subagent-state.ts";

export function createSubagentCompletion(state: SubagentState) {
  const active = new Map<string, AbortController>(); const refused = new Set<string>(); let scheduled = false;
  const hint = () => {
    if (state.closing || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (state.closing) return;
      let afterId: string | undefined;
      for (;;) {
        const page = state.deps.executions.pending({ afterId, limit: 200 });
        for (const result of page) if (result) start(result);
        if (page.length < 200) break;
        afterId = page.at(-1)!.completionId;
      }
    });
  };
  const start = (result: SubagentResultGroup) => {
    if (state.closing || active.has(result.completionId) || refused.has(result.completionId)) return;
    const bound = state.bindings.get(result.child.workInputId);
    if (!eligible(state, result, bound)) return;
    const characterId = state.deps.children.get(result.child.subagentId).characterId;
    const release = state.deps.queue.tryAcquireBackground(characterId);
    if (!release) { defer(state, result, "foreground_busy"); return; }
    const controller = new AbortController(); active.set(result.completionId, controller);
    const work = admitAndExecute(state, bound!, { result, characterId, controller }).catch(() => {
      refused.add(result.completionId);
      defer(state, result, "authority_unavailable"); state.deps.reportError("SUBAGENT_PARENT_ADMISSION_UNAVAILABLE");
    }).finally(() => {
      active.delete(result.completionId); release();
      // Publication acquires its own normal Character lane after parent execution has released it.
    }).then(() => finishReport(state, result.completionId)).catch(() => state.deps.reportError("SUBAGENT_REPORT_UNAVAILABLE"))
      .finally(() => { state.work.delete(work); });
    state.work.add(work);
  };
  return { hint, retry() { refused.clear(); hint(); }, close() { for (const controller of active.values()) controller.abort("core shutdown"); } };
}

function eligible(state: SubagentState, result: SubagentResultGroup, bound?: BoundSubagentWork): boolean {
  if (!bound) { defer(state, result, "source_unavailable"); return false; }
  const current = checkWorkCurrent(state, bound, { token: state.deps.executions.token(result.completionId), phase: "parent_admission" });
  if (current.state === "current") return true;
  if (current.state === "unavailable") defer(state, result, "source_unavailable");
  else state.deps.executions.setCompletion({ completionId: result.completionId, state: "withheld",
    reason: current.state === "superseded" ? "superseded" : current.reason === "expired" ? "expired" : "source_retired" });
  return false;
}

async function admitAndExecute(state: SubagentState, bound: BoundSubagentWork,
  input: { result: SubagentResultGroup; characterId: string; controller: AbortController }): Promise<void> {
  const { deps } = state; const { result, characterId, controller } = input;
  const admission = await deps.runs.admitLinked({ triggerRequestId: randomUUID(),
    idempotencyKey: `subagent-completion:${result.completionId}`, characterId, initiator: "subagent", deliveryClass: "internal",
    contextMode: "autonomous", provenance: { provider: "core.subagent-completion", parentRunId: bound.binding.parentRunId },
    payloadRef: result.completionId,
    ...(bound.root.workValidity.kind === "expires_at" ? { deadlineAt: bound.root.workValidity.expiresAt } : {}) },
  { signal: controller.signal, linked: { kind: "parent-continuation", completionId: result.completionId, resultDigest: result.childDigest,
    validateTx() {
      if (state.closing || controller.signal.aborted || !eligible(state, result, bound)) throw new Error("SUBAGENT_COMPLETION_NOT_ADMISSIBLE");
    } } });
  if (admission.reused || !deps.runs.start(admission.run.runId, admission.attempt.attemptId)) return;
  deps.changed(characterId, result.child.subagentId);
  await executeParentContinuation(state, bound, { result, runId: admission.run.runId, attemptId: admission.attempt.attemptId, controller });
}

function defer(state: SubagentState, result: SubagentResultGroup, reason: "foreground_busy" | "source_unavailable" | "authority_unavailable") {
  state.deps.executions.setCompletion({ completionId: result.completionId, state: "deferred", reason });
}

async function finishReport(state: SubagentState, completionId: string): Promise<void> {
  const result = state.deps.executions.result(completionId);
  if (!result?.parent || !result.parentDigest || !result.parentRunId) return;
  if (result.parent.decision !== "reply") return;
  if (state.deps.reports) await state.deps.reports.stageReply({ completionId, parentRunId: result.parentRunId, parentResultDigest: result.parentDigest });
  else state.deps.executions.recordPublication({ completionId, parentResultDigest: result.parentDigest,
    publication: { state: "refused", reason: "reply_authority_unavailable" } });
}
