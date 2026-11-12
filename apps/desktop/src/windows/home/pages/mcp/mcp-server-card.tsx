/**
 * INPUT:  one Core MCP desired/runtime view, action callbacks, and the dismissed-diagnostics flag + setter
 * OUTPUT: server name, connection facts, selected-tool disclosure, truthful outcomes, and lifecycle actions
 * POS:    disposable Home MCP detail; bookkeeping stays internal, secrets never render, and removal is confirmed
 */

import type { McpServerView } from "@taki/shared";
import { Badge } from "../../badge.tsx";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { ChevronDownIcon } from "@/lib/icons/chevron-down-icon.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { FAILURE_REASON_LABEL, PHASE_LABEL, transportLine } from "./mcp-labels.ts";

export interface McpServerCardActions {
  server: McpServerView;
  disabled: boolean;
  pending?: string | null;
  confirmRemove: boolean;
  /** Whether THIS server's current diagnostics banner was dismissed (keyed per outcome, see mcpDiagnosticKey). */
  diagnosticsDismissed: boolean;
  onDismissDiagnostics(): void;
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
  const outcome = server.status.lastOutcome;
  // A generation can also describe a draining connection; only connected proves it can serve new calls.
  const hasActiveConnection = server.status.phase === "connected" && server.status.runtimeGeneration !== null;
  return (
    <PageCard title={server.serverId} action={<Badge tone={phase.tone}>{phase.text}</Badge>}>
      <p className="text-xs text-text-secondary">{transportLine(server)}</p>
      <p className="mt-1 text-xs text-text-secondary">工具 {server.status.toolCount} 个</p>
      {outcome?.status === "failed" && !input.diagnosticsDismissed && (
        <div className="mt-2">
          <FeedbackLine tone="warn" action={{ label: "知道了", onClick: input.onDismissDiagnostics }}>
            最近一次连接失败：{FAILURE_REASON_LABEL[outcome.reason] ?? outcome.reason} — {outcome.message}
            {hasActiveConnection && "（现有连接仍可使用）"}
          </FeedbackLine>
        </div>
      )}
      {outcome?.status === "published" && (
        <p className="mt-2 text-xs text-text-secondary">最近连接成功：{outcome.toolNames.length} 个工具 / 耗时 {outcome.durationMs} 毫秒</p>
      )}
      <SelectedToolsDisclosure tools={server.selectedTools} />
      <Actions {...input} />
    </PageCard>
  );
}

function SelectedToolsDisclosure({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null;
  return (
    <details className="group mt-3">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-body">
        <ChevronDownIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        选定工具
      </summary>
      <p className="mt-2 text-xs text-text-secondary">{tools.join("、")}</p>
    </details>
  );
}

function Actions(input: McpServerCardActions) {
  const { server, disabled } = input;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <ActionButton tone="primary" busy={input.pending === `test:${server.serverId}`} disabled={disabled} onClick={input.onTest}>测试</ActionButton>
      <ActionButton busy={input.pending === `reconnect:${server.serverId}`} disabled={disabled || !server.enabled} onClick={input.onReconnect}>重连</ActionButton>
      <ActionButton busy={input.pending === `${server.enabled ? "disable" : "enable"}:${server.serverId}`} disabled={disabled} onClick={input.onToggleEnabled}>{server.enabled ? "停用" : "启用"}</ActionButton>
      <ActionButton disabled={disabled} onClick={input.onEdit}>编辑</ActionButton>
      {input.confirmRemove ? (
        <>
          <ActionButton tone="danger" busy={input.pending === `remove:${server.serverId}`} disabled={disabled} onClick={input.onConfirmRemove}>确认移除</ActionButton>
          <ActionButton disabled={disabled} onClick={input.onCancelRemove}>取消</ActionButton>
        </>
      ) : (
        <ActionButton tone="danger-soft" disabled={disabled} onClick={input.onAskRemove}>移除</ActionButton>
      )}
    </div>
  );
}
