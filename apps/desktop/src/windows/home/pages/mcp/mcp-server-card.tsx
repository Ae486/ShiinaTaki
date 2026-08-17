/**
 * INPUT: one Core MCP desired/runtime view and action callbacks
 * OUTPUT: truthful status/facts/diagnostics plus test, reconnect, toggle, edit, and remove controls
 * POS: Home MCP presentation card; env/header values and secret markers never render
 */

import type { McpServerView } from "@taki/shared";
import { Badge } from "../../badge.tsx";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";

const PHASE_LABEL: Record<McpServerView["status"]["phase"], { text: string; tone: "ok" | "warn" | "neutral" | "muted" }> = {
  connected: { text: "已连接", tone: "ok" },
  connecting: { text: "连接中", tone: "neutral" },
  failed: { text: "失败", tone: "warn" },
  draining: { text: "排空中", tone: "neutral" },
  disconnected: { text: "未连接", tone: "neutral" },
  disabled: { text: "已停用", tone: "muted" },
};

const FAILURE_REASON_LABEL: Record<string, string> = {
  "connect-failed": "连接失败",
  "secret-unresolvable": "密钥无法解析（目录锁定或缺失）",
  "tools-list-failed": "工具列举失败",
  "deadline-exceeded": "候选超时",
  "tool-key-collision": "工具名冲突",
};

export interface McpServerCardActions {
  server: McpServerView;
  disabled: boolean;
  confirmRemove: boolean;
  onAskRemove(): void;
  onCancelRemove(): void;
  onConfirmRemove(): void;
  onToggleEnabled(): void;
  onEdit(): void;
  onReconnect(): void;
  onTest(): void;
}

export function McpServerCard(input: McpServerCardActions) {
  const { server } = input;
  const phase = PHASE_LABEL[server.status.phase];
  return (
    <PageCard
      title={server.serverId}
      action={
        <div className="flex items-center gap-1.5">
          <Badge tone={phase.tone}>{phase.text}</Badge>
          <Badge tone="neutral">修订 {server.configRevision}</Badge>
          {server.status.runtimeGeneration !== null && <Badge tone="muted">代次 {server.status.runtimeGeneration}</Badge>}
          <Badge tone="muted">工具 {server.status.toolCount}</Badge>
        </div>
      }
    >
      <p className="text-xs text-slate-500">{transportLine(server)}</p>
      {server.selectedTools.length > 0 && <p className="mt-1 text-xs text-slate-500">选定工具：{server.selectedTools.join("、")}</p>}
      <Diagnostics outcome={server.status.lastOutcome} />
      <Actions {...input} />
    </PageCard>
  );
}

function transportLine(server: McpServerView): string {
  if (server.config && "command" in server.config) {
    return `stdio · ${server.config.command} ${(server.config.args ?? []).join(" ")}`.trimEnd();
  }
  return `http · ${server.config.url}`;
}

/** Sanitized last-candidate diagnostics: a failure keeps serving last-good (stated), a publish states its facts. */
function Diagnostics({ outcome }: { outcome: McpServerView["status"]["lastOutcome"] }) {
  if (outcome === null) return null;
  if (outcome.status === "failed") {
    return (
      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-100">
        最近一次候选失败：{FAILURE_REASON_LABEL[outcome.reason] ?? outcome.reason} — {outcome.message}（上一次良好代次继续服务）
      </p>
    );
  }
  if (outcome.status === "published") {
    return <p className="mt-2 text-xs text-slate-400">最近发布：{outcome.toolNames.length} 个工具 / {outcome.pages} 页列举 / {outcome.durationMs}ms</p>;
  }
  return null;
}

function Actions(input: McpServerCardActions) {
  const { server, disabled } = input;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <ActionButton disabled={disabled} onClick={input.onTest}>测试</ActionButton>
      <ActionButton disabled={disabled || !server.enabled} onClick={input.onReconnect}>重连</ActionButton>
      <ActionButton disabled={disabled} onClick={input.onToggleEnabled}>{server.enabled ? "停用" : "启用"}</ActionButton>
      <ActionButton disabled={disabled} onClick={input.onEdit}>编辑</ActionButton>
      {input.confirmRemove ? (
        <>
          <ActionButton tone="danger" disabled={disabled} onClick={input.onConfirmRemove}>确认移除</ActionButton>
          <ActionButton disabled={disabled} onClick={input.onCancelRemove}>取消</ActionButton>
        </>
      ) : (
        <ActionButton tone="danger-soft" disabled={disabled} onClick={input.onAskRemove}>移除</ActionButton>
      )}
    </div>
  );
}
