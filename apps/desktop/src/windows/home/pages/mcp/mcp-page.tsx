/**
 * INPUT: Core-authoritative MCP view state, page-local editor drafts, selection memory and dismissed diagnostics
 * OUTPUT: master-detail lifecycle page (L2): server list pane + detail/editor pane, complete states and actions
 * POS: Home MCP presentation; the controller owns mutations, selection/drafts/dismissals are component memory,
 *      no MCP truth is persisted locally or echoed. Panes stack vertically in narrow containers (container query).
 */

import { useState, type ReactNode } from "react";
import type { McpServerView } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { ExtensionConvergenceStrip, useExtensionConvergence } from "../../extension-convergence.tsx";
import { ReadObservationNotice } from "../../read-observation-notice.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { PageCard } from "../../page-card.tsx";
import { MasterDetail } from "@/components/ui/master-detail.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { previousMcpData, resolveSelectedServer, type McpFeedback, type McpServerDraft } from "./mcp-state.ts";
import { useMcpServers } from "./use-mcp.ts";
import { useMcpEditor } from "./use-mcp-editor.ts";
import { McpServerCard } from "./mcp-server-card.tsx";
import { McpServerEditor } from "./mcp-server-editor.tsx";
import { McpServerList } from "./mcp-server-list.tsx";
import { mcpDiagnosticKey } from "./mcp-labels.ts";

export function McpPage() {
  const mcp = useMcpServers();
  const editor = useMcpEditor(mcp);
  const convergence = useExtensionConvergence("mcp", mcpConvergenceKey(mcp.state));
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dismissedDiagnostics, setDismissedDiagnostics] = useState<ReadonlySet<string>>(new Set());
  const dismissDiagnostics = (key: string): void => {
    setDismissedDiagnostics((previous) => new Set(previous).add(key));
  };

  return (
    <>
      <PageHeader
        title="MCP 服务器"
        hint="添加、编辑、启停和移除即时生效，无需重启。已保存的凭据无法再次查看。"
        busy={mcp.state.kind === "loading" && mcp.state.previous !== null}
      />
      <ExtensionConvergenceStrip state={convergence.state} onRefresh={convergence.refresh} connectionReady={convergence.connectionReady} />
      <ReadObservationNotice observation={mcp.observation} onRefresh={mcp.refresh} disabled={!mcp.connectionReady} />
      <McpPageBody input={{
        mcp, ...editor, confirmRemove, selectedId, dismissedDiagnostics,
        setConfirmRemove, setSelectedId, dismissDiagnostics,
      }} />
    </>
  );
}

function mcpConvergenceKey(state: ReturnType<typeof useMcpServers>["state"]): string | null {
  const servers = previousMcpData(state);
  return servers?.map((server) => [
    server.serverId,
    server.configRevision,
    server.status.runtimeGeneration ?? 0,
    server.status.phase,
  ].join(":" )).join("|") ?? null;
}

interface McpPageBodyInput extends ReturnType<typeof useMcpEditor> {
  mcp: ReturnType<typeof useMcpServers>;
  confirmRemove: string | null;
  selectedId: string | null;
  dismissedDiagnostics: ReadonlySet<string>;
  setConfirmRemove(id: string | null): void;
  setSelectedId(id: string | null): void;
  dismissDiagnostics(key: string): void;
}

function McpPageBody({ input }: { input: McpPageBodyInput }) {
  const { mcp, draft } = input;
  const servers = previousMcpData(mcp.state);
  const busy = mcp.pending !== null;
  const selected = resolveSelectedServer(servers, input.selectedId);
  const hasServers = servers !== null && servers.length > 0;
  const editorElement = draft !== null && <EditorForm draft={draft} input={input} mcp={mcp} busy={busy} />;
  return (
    <PageBody>
      {mcp.state.kind === "failure" && (
        <PageAlert action={{ label: "重试", onClick: () => void mcp.refresh() }}>
          {mcp.state.failureKind === "validation" ? "Core 返回的 MCP 快照校验失败" : `读取 MCP 服务器失败：${mcp.state.message}`}
        </PageAlert>
      )}
      {mcp.feedback && <FeedbackBanner feedback={mcp.feedback} editing={draft !== null} />}
        <McpMasterDetail
          servers={servers}
          empty={servers === null
            ? mcp.state.kind === "loading" ? <Skeleton lines={4} /> : <p className="text-xs text-text-secondary">等待可用的服务器列表。</p>
            : <EmptyServerState disabled={!mcp.connectionReady || busy} onAdd={input.startAdd} />}
          selectedServerId={draft?.serverId ?? selected?.serverId ?? null}
          onSelect={input.setSelectedId}
          editorElement={editorElement}
          detailElement={selected !== null && draft === null && (
            <SelectedServerCard selected={selected} disabled={!mcp.connectionReady || busy || mcp.state.kind !== "ready"} hooks={input} />
          )}
        />
      {hasServers && draft === null && (
        <div className="flex justify-end gap-2">
          <ActionButton disabled={!mcp.connectionReady} onClick={() => void mcp.refresh()}>刷新</ActionButton>
          <ActionButton tone="primary" disabled={!mcp.connectionReady} onClick={input.startAdd}>添加服务器</ActionButton>
        </div>
      )}
    </PageBody>
  );
}

interface MasterDetailInput {
  servers: McpServerView[] | null;
  empty: ReactNode;
  selectedServerId: string | null;
  onSelect(serverId: string): void;
  /** The editor form while creating/editing, else false — it replaces the detail card in the right pane. */
  editorElement: false | ReactNode;
  detailElement: false | ReactNode;
}

/** The L2 two-pane layout (shared MasterDetail primitive): list left, detail/editor right; stacks under a narrow container. */
function McpMasterDetail(input: MasterDetailInput) {
  return (
    <MasterDetail
      list={input.servers?.length
        ? <McpServerList servers={input.servers} selectedId={input.selectedServerId} onSelect={input.onSelect} />
        : input.empty}
      detail={input.editorElement !== false ? input.editorElement : input.detailElement}
    />
  );
}

/** The editor pane form: client-side validation gate, then the controller write (add or edit). */
function EditorForm({ draft, input, mcp, busy }: { draft: McpServerDraft; input: McpPageBodyInput; mcp: ReturnType<typeof useMcpServers>; busy: boolean }) {
  return (
    <McpServerEditor
      draft={draft}
      onChange={input.setDraft}
      onCancel={input.clearEditor}
      onSave={() => void input.saveDraft()}
      error={input.formError}
      editing={input.editingRevision !== null}
      saving={busy}
      disabled={!mcp.connectionReady || (input.editingRevision !== null && !mcpServersOf(mcp)?.some((server) => server.serverId === draft.serverId))}
    />
  );
}

function mcpServersOf(mcp: ReturnType<typeof useMcpServers>): McpServerView[] | null {
  return previousMcpData(mcp.state);
}

/** The right-pane detail card for the selected server, wired to the page's action hooks. */
function SelectedServerCard({ selected, disabled, hooks }: { selected: McpServerView; disabled: boolean; hooks: McpPageBodyInput }) {
  return (
    <McpServerCard
      server={selected}
      disabled={disabled}
      confirmRemove={hooks.confirmRemove === selected.serverId}
      diagnosticsDismissed={hooks.dismissedDiagnostics.has(mcpDiagnosticKey(selected))}
      onDismissDiagnostics={() => hooks.dismissDiagnostics(mcpDiagnosticKey(selected))}
      onAskRemove={() => hooks.setConfirmRemove(selected.serverId)}
      onCancelRemove={() => hooks.setConfirmRemove(null)}
      onConfirmRemove={() => {
        hooks.setConfirmRemove(null);
        void hooks.mcp.remove({ serverId: selected.serverId, expectedRevision: selected.configRevision });
      }}
      onToggleEnabled={() => void hooks.mcp.setEnabled({ serverId: selected.serverId, enabled: !selected.enabled, expectedRevision: selected.configRevision })}
      onEdit={() => hooks.startEdit(selected)}
      onReconnect={() => void hooks.mcp.reconnect(selected.serverId)}
      onTest={() => void hooks.mcp.test(selected.serverId)}
    />
  );
}

function FeedbackBanner({ feedback, editing }: { feedback: McpFeedback; editing: boolean }) {
  const tone = feedback.kind === "saved" || feedback.kind === "tested"
    ? editing ? "info" : "ok"
    : feedback.kind === "conflict" ? "warn" : "danger";
  return <FeedbackLine tone={tone}>{editing ? `上次操作：${feedback.message}` : feedback.message}</FeedbackLine>;
}

function EmptyServerState({ disabled, onAdd }: { disabled: boolean; onAdd(): void }) {
  return (
    <PageCard title="尚未配置 MCP 服务器">
      <EmptyState
        title="尚未配置 MCP 服务器"
        hint="添加并连接服务器，接入需要的工具；使用时仍受权限设置限制。"
        action={<ActionButton tone="primary" disabled={disabled} onClick={onAdd}>添加服务器</ActionButton>}
      />
    </PageCard>
  );
}
