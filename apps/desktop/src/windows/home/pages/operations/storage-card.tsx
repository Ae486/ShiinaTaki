/**
 * INPUT:  the media.usage snapshot + the purge control from useOperations.
 * OUTPUT: <StorageCard> — retained-byte usage plus the D46 attachment purge with its mandatory confirm step.
 * POS:    ui/windows/home/pages/operations — presentational; the guard that makes the purge two-step lives in
 *         operations-state.ts, and this card can only emit its events.
 */

import type { MediaUsageResult } from "@taki/shared";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { formatBytes } from "./operations-state.ts";
import type { MediaClearControl } from "./use-media-clear.ts";

export function StorageCard({ usage, clear }: { usage: MediaUsageResult | null; clear: MediaClearControl }) {
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
        <p className="text-xs text-slate-400">载入中…</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {clear.phase === "idle" ? (
          <button
            type="button"
            onClick={() => clear.onEvent("request")}
            className="rounded-md border border-rose-200 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
          >
            清除全部附件字节
          </button>
        ) : (
          <>
            <span className="text-xs text-rose-600">确认清除？此操作不可撤销（记忆中的图片描述会保留）。</span>
            <button
              type="button"
              onClick={() => clear.onEvent("confirm")}
              disabled={clear.phase === "clearing"}
              className="rounded-md bg-rose-600 px-3 py-1.5 text-xs text-white disabled:opacity-40"
            >
              {clear.phase === "clearing" ? "清除中…" : "确认清除"}
            </button>
            <button type="button" onClick={() => clear.onEvent("cancel")} className="px-2 text-xs text-slate-500">
              取消
            </button>
          </>
        )}
      </div>
      {clear.notice && <p className="mt-1 text-xs text-emerald-700">{clear.notice}</p>}
      {clear.error && <p className="mt-1 text-xs text-rose-600">{clear.error}</p>}
    </PageCard>
  );
}
