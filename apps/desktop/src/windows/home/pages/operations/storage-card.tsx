/**
 * INPUT:  the media.usage snapshot + the purge control from useOperations.
 * OUTPUT: <StorageCard> — retained-byte usage plus the D46 attachment purge with its mandatory confirm step.
 * POS:    ui/windows/home/pages/operations — presentational; the guard that makes the purge two-step lives in
 *         operations-state.ts, and this card can only emit its events.
 */

import type { MediaUsageResult } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { formatBytes } from "./operations-state.ts";
import type { MediaClearControl } from "./use-media-clear.ts";

export function StorageCard({
  usage,
  clear,
  connectionReady,
}: {
  usage: MediaUsageResult | null;
  clear: MediaClearControl;
  connectionReady: boolean;
}) {
  return (
    <PageCard title="存储占用">
      {usage ? (
        <LabeledRows
          rows={[
            { label: "附件", value: `${usage.attachmentCount} 个 / ${formatBytes(usage.attachmentBytes)}` },
            { label: "记忆文本", value: formatBytes(usage.memoryTextBytes) },
          ]}
        />
      ) : (
        <Skeleton lines={2} />
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {clear.phase === "idle" ? (
          <ActionButton tone="danger-soft" onClick={() => clear.onEvent("request")} disabled={!connectionReady}>
            清除全部附件字节
          </ActionButton>
        ) : (
          <>
            <FeedbackLine tone="warn">确认清除？此操作不可撤销（记忆中的图片描述会保留）。</FeedbackLine>
            <ActionButton
              tone="danger"
              busy={clear.phase === "clearing"}
              onClick={() => clear.onEvent("confirm")}
              disabled={!connectionReady || clear.phase === "clearing"}
            >
              {clear.phase === "clearing" ? "清除中…" : "确认清除"}
            </ActionButton>
            <ActionButton onClick={() => clear.onEvent("cancel")} disabled={clear.phase === "clearing"}>
              取消
            </ActionButton>
          </>
        )}
      </div>
      {clear.notice && <div className="mt-2"><FeedbackLine tone="ok">{clear.notice}</FeedbackLine></div>}
      {clear.error && <div className="mt-2"><FeedbackLine tone="danger">{clear.error}</FeedbackLine></div>}
    </PageCard>
  );
}
