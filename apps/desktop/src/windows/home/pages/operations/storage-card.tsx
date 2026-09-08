/**
 * INPUT:  the media.usage snapshot + the purge control from useOperations.
 * OUTPUT: <StorageCard> — retained-byte usage plus the D46 attachment purge with its mandatory confirm step.
 * POS:    ui/windows/home/pages/operations — presentational; the guard that makes the purge two-step lives in
 *         operations-state.ts, and this card can only emit its events.
 */

import type { MediaUsageResult } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { PageAlert } from "../../page-chrome.tsx";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { formatBytes } from "./operations-state.ts";
import type { MediaClearControl } from "./use-media-clear.ts";

export function StorageCard({
  usage,
  clear,
  connectionReady,
  read,
}: {
  usage: MediaUsageResult | null;
  clear: MediaClearControl;
  connectionReady: boolean;
  read: { loading: boolean; error: string | null; retry(): Promise<void> };
}) {
  return (
    <PageCard title="存储占用">
      {read.error && <PageAlert action={{ label: "重试", onClick: () => void read.retry() }}>读取存储占用失败：{read.error}</PageAlert>}
      {usage ? (
        <LabeledRows
          rows={[
            { label: "附件", value: `${usage.attachmentCount} 个 / ${formatBytes(usage.attachmentBytes)}` },
            { label: "记忆文本", value: formatBytes(usage.memoryTextBytes) },
          ]}
        />
      ) : read.loading ? (
        <Skeleton lines={2} />
      ) : !read.error && <p className="text-xs text-text-secondary">等待连接以读取存储占用。</p>}
      <ClearControls clear={clear} connectionReady={connectionReady} />
      {clear.error && <div className="mt-2"><FeedbackLine tone="danger">{clear.error}</FeedbackLine></div>}
    </PageCard>
  );
}

function ClearControls({ clear, connectionReady }: { clear: MediaClearControl; connectionReady: boolean }) {
  return (
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
              确认清除
            </ActionButton>
            <ActionButton onClick={() => clear.onEvent("cancel")} disabled={clear.phase === "clearing"}>
              取消
            </ActionButton>
          </>
        )}
    </div>
  );
}
