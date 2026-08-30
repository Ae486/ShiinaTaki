/**
 * INPUT:  one Core MCP desired/runtime view, action callbacks, and the dismissed-diagnostics flag + setter
 * OUTPUT: the detail-pane card (U2): display name + phase badge, transport line, tool count, dismissible bounded
 *         diagnostics, a collapsed 运行与配置详情 disclosure (CopyableRow diagnostics), and test/reconnect/toggle/
 *         edit/remove actions with the two-step remove confirm
 * POS:    Home MCP presentation detail; technical identifiers live only inside the disclosure, sanitized failure
 *         wording stays truthful (last-good statement preserved), and secret values never render.
 */

import type { McpServerView } from "@taki/shared";
import { Badge } from "../../badge.tsx";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { ChevronDownIcon } from "@/lib/icons/chevron-down-icon.js";
import { CopyableRow } from "@/components/ui/copyable-row.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { FAILURE_REASON_LABEL, PHASE_LABEL, transportLine } from "./mcp-labels.ts";

export interface McpServerCardActions {
  server: McpServerView;
  disabled: boolean;
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
  return (
    <PageCard title={server.serverId} action={<Badge tone={phase.tone}>{phase.text}</Badge>}>
      <p className="text-xs text-text-secondary">{transportLine(server)}</p>
      <p className="mt-1 text-xs text-text-secondary">工具 {server.status.toolCount} 个</p>
      {outcome?.status === "failed" && !input.diagnosticsDismissed && (
        <div className="mt-2">
          <FeedbackLine tone="warn" action={{ label: "知道了", onClick: input.onDismissDiagnostics }}>
            最近一次候选失败：{FAILURE_REASON_LABEL[outcome.reason] ?? outcome.reason} — {outcome.message}（上一次良好代次继续服务）
          </FeedbackLine>
        </div>
      )}
      {outcome?.status === "published" && (
        <p className="mt-2 text-xs text-text-secondary">最近发布：{outcome.toolNames.length} 个工具 / {outcome.pages} 页列举 / {outcome.durationMs}ms</p>
      )}
      <DetailsDisclosure server={server} />
      <Actions {...input} />
    </PageCard>
  );
}

/** 修订/代次/Owner/选定工具 leave the primary card (U2/N6 UI side); copy-diagnostic rows keep the full values. */
function DetailsDisclosure({ server }: { server: McpServerView }) {
  return (
    <details className="group mt-3">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-body">
        <ChevronDownIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        运行与配置详情
      </summary>
      <div className="mt-2 flex flex-col gap-1">
        <CopyableRow label="修订" value={String(server.configRevision)} />
        <CopyableRow label="代次" value={server.status.runtimeGeneration === null ? "—" : String(server.status.runtimeGeneration)} />
        <CopyableRow label="Owner" value={server.ownerHostId} mono />
        {server.selectedTools.length > 0 && (
          <p className="mt-1 text-xs text-text-secondary">选定工具：{server.selectedTools.join("、")}</p>
        )}
      </div>
    </details>
  );
}

function Actions(input: McpServerCardActions) {
  const { server, disabled } = input;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <ActionButton tone="primary" disabled={disabled} onClick={input.onTest}>测试</ActionButton>
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
