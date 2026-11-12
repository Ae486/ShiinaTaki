import { SubagentHistoryResultSchema, type SubagentInput, type SubagentResultView, type SubagentSummary } from "@taki/shared";

export const CHILD_A = "00000000-0000-4000-8000-000000000001";
export const CHILD_B = "00000000-0000-4000-8000-000000000002";
export const WORK_A = "00000000-0000-4000-8000-000000000011";
export const WORK_B = "00000000-0000-4000-8000-000000000012";
export const INPUT_A = "00000000-0000-4000-8000-000000000021";
const time = "2026-10-23T04:00:00.000Z";
const digest = "a".repeat(64);

export function summary(subagentId = CHILD_A): SubagentSummary {
  return { subagentId, characterId: "taki", label: subagentId === CHILD_A ? "视频中的城市记忆" : "整理参考资料",
    createdAt: time, activeRunId: "run-child-a", activeWorkInputId: WORK_A, latestWorkInputId: WORK_A,
    latestCompletionId: "run-child-finished", controlVersion: 2, stopOrigin: null, pendingRequest: null,
    progress: null, tokenUsage: null, state: "running" };
}
export function work(overrides: Partial<SubagentInput> = {}): SubagentInput {
  return { inputId: WORK_A, subagentId: CHILD_A, inputSeq: 1, workInputId: WORK_A, workSeq: 1,
    operationKey: "test-work", requestDigest: digest, kind: "work", sender: { kind: "parent", runId: "run-parent" },
    direction: "整理视频讲述者的城市经历，并区分来源与用户自己的经历。", materials: [], toolSelection: null,
    createdAt: time, completionPolicy: "request_parent", workExpiresAt: "2026-10-23T23:00:00.000Z",
    workValidity: { kind: "expires_at", expiresAt: "2026-10-23T23:00:00.000Z" }, replyToEventId: null,
    consumed: { runId: "run-child-a", attemptId: "attempt-a", step: 0, effectId: "effect-a" }, replyAcceptance: null, ...overrides };
}
export function resultView(): SubagentResultView {
  const terminal = { runId: "run-child-finished", attemptId: "attempt-finished", outcome: "completed" as const,
    body: "讲述者曾在京都生活。视频中的第一人称指向讲述者，不能据此认定用户也有同样经历。",
    outputKind: "validated" as const, sourceContext: { materials: [{ label: "视频讲述者的经历", speaker: "视频讲述者" }] },
    receiptId: "receipt-finished", settledAt: time };
  return { result: { completionId: terminal.runId, child: { ...terminal, subagentId: CHILD_A, workInputId: WORK_A,
    throughWorkSeq: 1, workExpiresAt: "2026-10-23T23:00:00.000Z", currentness: "current" }, childDigest: digest,
    completionState: "admitted", completionReason: null, parentRunId: "run-parent-synthesis",
    parent: { ...terminal, runId: "run-parent-synthesis", decision: "internal_result", body: "已保留来源区分，暂不向主对话发布。" },
    parentDigest: digest, publication: { state: "internal_only" } }, deliveryState: null };
}
export function history(subagentId = CHILD_A) {
  const first = work({ subagentId });
  return SubagentHistoryResultSchema.parse({ conversation: summary(subagentId),
    inputs: [first, work({ subagentId, inputId: INPUT_A, inputSeq: 2, workSeq: 2, kind: "message", sender: { kind: "user" },
      direction: "请保留视频讲述者的来源，不要当成我的经历。", consumed: null })],
    messages: Array.from({ length: 8 }, (_, index) => ({ seq: index + 1, runId: "run-child-a", attemptId: "attempt-a", stepNumber: index,
      messageIndex: 0, entryKind: "output", inputId: null, modelEffectId: null, modelInputDigest: null, createdAt: time,
      role: "assistant", content: `第 ${index + 1} 段整理：已依据提供的材料梳理视频讲述者的城市经历。保留来源说明，并将可验证内容与不确定信息分开。` })),
    results: subagentId === CHILD_A ? [resultView()] : [], executions: [{ runId: "run-child-a", workInputId: WORK_A, throughWorkSeq: 1, state: "running" }],
    nextMessageSeq: null, nextInputSeq: null, nextCompletionId: null });
}
