/**
 * INPUT:  an optional Core-produced per-Bank policy review snapshot
 * OUTPUT: labelled review facts and the persistent historical catch-up record identity
 * POS:    Home read model — null state means idle; absent evidence/counts remain unknown
 */
import type { MemoryPolicyReviewStatus } from "@taki/shared";
import type { LabeledRow } from "../../page-card.tsx";

export interface MemoryPolicyReviewView {
  rows: LabeledRow[];
  catchUpOccurrenceId: string | null;
}

const STATE_LABEL: Record<NonNullable<MemoryPolicyReviewStatus["state"]>, string> = {
  pending: "待处理", running: "执行中", paused: "已暂停", error: "错误",
};
const UNKNOWN = "未知";

export function memoryPolicyReviewView(review: MemoryPolicyReviewStatus | undefined): MemoryPolicyReviewView {
  return {
    rows: [
      { label: "巡检状态", value: review ? review.state === null ? "空闲" : STATE_LABEL[review.state] : UNKNOWN },
      { label: "巡检到期时间", value: review?.dueSince ?? UNKNOWN },
      { label: "待巡检数量", value: String(review?.eligibleRemaining ?? UNKNOWN) },
      { label: "已保存待发布", value: String(review?.savedAwaitingPublication ?? UNKNOWN) },
      { label: "上次巡检完成", value: review?.lastCompletedAt ?? UNKNOWN },
      { label: "补跑记录", value: review ? review.catchUpOccurrenceId ? "已记录（跨重启保留）" : "无" : UNKNOWN },
    ],
    catchUpOccurrenceId: review?.catchUpOccurrenceId ?? null,
  };
}
