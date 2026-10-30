/**
 * INPUT: the local QQMM controller; no Core/operator connection is required.
 * OUTPUT: QQ history/details and complete settings, connection controls and retry access.
 * POS: Home QQ messages — registry page using shared Taki chrome and semantic QQMM state.
 */

import { useState } from "react";
import type { ManagementController, ManagementState } from "@qqmm/management-client";
import { EmptyState } from "@/components/ui/empty-state.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import { PageBody, PageHeader } from "../../page-chrome.tsx";
import { useQqmm } from "./use-qqmm.ts";
import { QqmmFilters } from "./qqmm-filters.tsx";
import { QqmmSettings } from "./qqmm-settings.tsx";
import { QqmmControls } from "./qqmm-controls.tsx";
import { QqmmTimeline } from "./qqmm-timeline.tsx";
import { QqmmDetail } from "./qqmm-detail.tsx";
import { captureLabel } from "./qqmm-labels.ts";

export function QqmmPage() {
  const view = useQqmm();
  return <section aria-label="QQ 消息" className="@container flex min-h-0 flex-1 flex-col">
    <PageHeader title="QQ 消息" hint="查看本机消息、摘要、工具结果与运行记录。重启后仍可查询保留期内的内容。" busy={view.state?.loading} />
    {!view.state || !view.controller
      ? <EmptyState title={view.error ? "暂时无法连接本机日志" : "正在连接本机日志…"} hint={view.error ?? undefined} action={view.error && <ActionButton onClick={view.retry}>重试</ActionButton>} />
      : <QqmmContent state={view.state} controller={view.controller} />}
  </section>;
}

export function QqmmContent({ state, controller }: { state: ManagementState; controller: ManagementController }) {
  const [tab, setTab] = useState<"records" | "settings">("records");
  const ready = state.connection === "connected" && state.monitor?.historyState === "ready";
  const select = (next: "records" | "settings") => {
    setTab(next); if (next === "settings") controller.closeDetail();
    else { const secret = controller.getState().secretDraft; if (secret.name && secret.value) controller.setSecretDraft(secret.name, ""); }
  };
  return <>
    <QqmmStatus state={state} controller={controller} />
    <nav aria-label="记录与设置" className="flex shrink-0 items-center gap-2 border-b border-border px-6 py-2">
      <ActionButton tone={tab === "records" ? "accent" : "ghost"} aria-expanded={tab === "records"} onClick={() => select("records")}>记录</ActionButton>
      <ActionButton tone={tab === "settings" ? "accent" : "ghost"} aria-expanded={tab === "settings"} onClick={() => select("settings")}>设置</ActionButton>
      {state.config && <span className="ml-auto text-xs text-text-secondary">{state.connection === "connected" ? "当前" : "上次读取"} {state.config.retentionDays} 天</span>}
    </nav>
    {tab === "settings" ? <PageBody><QqmmControls state={state} controller={controller} /><QqmmSettings state={state} controller={controller} /></PageBody> : <>
      {ready && <><QqmmFilters state={state} controller={controller} /><QqmmTimeline state={state} controller={controller} /></>}
      {!ready && !state.error && <EmptyState title={state.connection === "connecting" ? "正在连接本机日志…" : "正在准备历史记录…"} />}
    </>}
    <QqmmDetail state={ready && tab === "records" ? state : null} controller={controller} />
  </>;
}

function QqmmStatus({ state, controller }: { state: ManagementState; controller: ManagementController }) {
  const monitor = state.connection === "connected" ? state.monitor : null;
  return <div className="grid shrink-0 gap-2 border-b border-border px-6 py-2">
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary" role="status">
      <span>{state.connection === "connected" ? "本机日志已连接" : state.connection === "connecting" ? "正在连接本机日志" : "本机日志连接已断开"}</span>
      {monitor && <span>{captureLabel(monitor)}</span>}
      {monitor?.account && <span>QQ {monitor.account}</span>}
      {monitor?.historyState === "ready" && <span>历史记录可查询</span>}
    </div>
    {state.error && <FeedbackLine tone="warn" action={{ label: "重试", onClick: () => void controller.refresh() }}>{state.error}</FeedbackLine>}
    {monitor?.maintenanceFailed && <FeedbackLine tone="warn">到期数据清理尚未完成，超期内容已停止显示。</FeedbackLine>}
    {monitor?.historyState === "ready" && !monitor.recordingAvailable && <FeedbackLine tone="warn">新日志暂时无法写入，已有历史仍可查询。</FeedbackLine>}
    {monitor?.historyState === "upgrade_required" && <FeedbackLine tone="warn">需要先处理旧摘要的保留期升级。
      {monitor.upgradePreview && ` 涉及 ${monitor.upgradePreview.unknownSummaryCount} 份摘要、${monitor.upgradePreview.affectedConversationCount} 个会话。`}
    </FeedbackLine>}
  </div>;
}
