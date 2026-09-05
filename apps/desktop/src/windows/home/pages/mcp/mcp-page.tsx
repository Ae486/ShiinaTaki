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
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { PageCard } from "../../page-card.tsx";
import { MasterDetail } from "@/components/ui/master-detail.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { draftFromView, emptyDraft, resolveSelectedServer, validateDraft, type McpFeedback, type McpServerDraft } from "./mcp-state.ts";
import { useMcpServers } from "./use-mcp.ts";
import { McpServerCard } from "./mcp-server-card.tsx";
import { McpServerEditor } from "./mcp-server-editor.tsx";
import { McpServerList } from "./mcp-server-list.tsx";
import { mcpDiagnosticKey } from "./mcp-labels.ts";
import type { McpEditorMutationResult } from "./mcp-controller.ts";

export function McpPage() {
  const mcp = useMcpServers();
  const convergence = useExtensionConvergence(mcpConvergenceKey(mcp.state));
  const [draft, setDraft] = useState<McpServerDraft | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dismissedDiagnostics, setDismissedDiagnostics] = useState<ReadonlySet<string>>(new Set());
  const clearEditor = (): void => {
    setDraft(null);
    setEditingRevision(null);
    setFormError(null);
  };
  const startAdd = (): void => {
    setDraft(emptyDraft());
    setEditingRevision(null);
    setFormError(null);
  };
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
      <ExtensionConvergenceStrip state={convergence} />
      <McpPageBody input={{
        mcp, draft, editingRevision, confirmRemove, formError, selectedId, dismissedDiagnostics,
        setDraft, setEditingRevision, setConfirmRemove, setFormError,
        setSelectedId, clearEditor, startAdd, dismissDiagnostics,
      }} />
    </>
  );
}

function mcpConvergenceKey(state: ReturnType<typeof useMcpServers>["state"]): string {
  const servers = state.kind === "ready" ? state.data : state.kind === "failure" ? state.previous : state.previous;
  return (servers ?? []).map((server) => [
    server.serverId,
    server.configRevision,
    server.status.runtimeGeneration ?? 0,
    server.status.phase,
  ].join(":" )).join("|");
}

interface McpPageBodyInput {
  mcp: ReturnType<typeof useMcpServers>;
  draft: McpServerDraft | null;
  editingRevision: number | null;
  confirmRemove: string | null;
  formError: string | null;
  selectedId: string | null;
  dismissedDiagnostics: ReadonlySet<string>;
  setDraft(draft: McpServerDraft | null): void;
  setEditingRevision(revision: number | null): void;
  setConfirmRemove(id: string | null): void;
  setFormError(error: string | null): void;
  setSelectedId(id: string | null): void;
  clearEditor(): void;
  startAdd(): void;
  dismissDiagnostics(key: string): void;
}

function McpPageBody({ input }: { input: McpPageBodyInput }) {
  const { mcp, draft } = input;
  const servers = mcp.state.kind === "ready" ? mcp.state.data : mcp.state.kind === "failure" ? mcp.state.previous : null;
  const busy = mcp.state.kind === "ready" && mcp.state.pending !== null;
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
      {mcp.state.kind === "ready" && mcp.state.feedback && <FeedbackBanner feedback={mcp.state.feedback} />}
      {servers === null && mcp.state.kind === "loading" && <Skeleton lines={4} />}
      {servers !== null && servers.length === 0 && draft === null && <EmptyServerState disabled={!mcp.connectionReady} onAdd={input.startAdd} />}
      {hasServers && (
        <McpMasterDetail
          servers={servers}
          selectedServerId={draft?.serverId ?? selected?.serverId ?? null}
          onSelect={input.setSelectedId}
          editorElement={editorElement}
          detailElement={selected !== null && draft === null && (
            <SelectedServerCard selected={selected} disabled={!mcp.connectionReady || busy} hooks={input} />
          )}
        />
      )}
      {editorElement !== false && !hasServers && <div className="flex flex-col gap-4">{editorElement}</div>}
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
  servers: McpServerView[];
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
      list={<McpServerList servers={input.servers} selectedId={input.selectedServerId} onSelect={input.onSelect} />}
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
      onSave={() => void saveDraft(draft, {
        editingRevision: input.editingRevision, servers: mcpServersOf(mcp), add: mcp.add, edit: mcp.edit,
        setEditingRevision: input.setEditingRevision, setFormError: input.setFormError, clearEditor: input.clearEditor,
      })}
      error={input.formError}
      editing={input.editingRevision !== null}
      saving={busy}
    />
  );
}

function mcpServersOf(mcp: ReturnType<typeof useMcpServers>): McpServerView[] | null {
  return mcp.state.kind === "ready" ? mcp.state.data : mcp.state.kind === "failure" ? mcp.state.previous : null;
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
      onEdit={() => { hooks.setDraft(draftFromView(selected)); hooks.setEditingRevision(selected.configRevision); hooks.setFormError(null); }}
      onReconnect={() => void hooks.mcp.reconnect(selected.serverId)}
      onTest={() => void hooks.mcp.test(selected.serverId)}
    />
  );
}

interface SaveInput {
  editingRevision: number | null;
  servers: McpServerView[] | null;
  add(draft: McpServerDraft): Promise<McpEditorMutationResult>;
  edit(draft: McpServerDraft, expectedRevision: number): Promise<McpEditorMutationResult>;
  setEditingRevision(revision: number | null): void;
  setFormError(error: string | null): void;
  clearEditor(): void;
}

/** Client-side validation gate, then the controller write (add or edit); the form error stays until fixed. */
async function saveDraft(draft: McpServerDraft, input: SaveInput): Promise<void> {
  const { editingRevision, servers } = input;
  const editing = editingRevision !== null;
  const existing = new Set((servers ?? []).filter((server) => !editing || server.serverId !== draft.serverId).map((server) => server.serverId));
  const error = validateDraft(draft, existing);
  if (error !== null) {
    input.setFormError(error);
    return;
  }
  input.setFormError(null);
  const result = editingRevision === null
    ? await input.add(draft)
    : await input.edit(draft, editingRevision);
  if (!result.ok) {
    if (result.committedRevision !== undefined) input.setEditingRevision(result.committedRevision);
    return;
  }
  input.clearEditor();
}

function FeedbackBanner({ feedback }: { feedback: McpFeedback }) {
  const tone = feedback.kind === "saved" || feedback.kind === "tested"
    ? "ok"
    : feedback.kind === "conflict" ? "warn" : "danger";
  return <FeedbackLine tone={tone}>{feedback.message}</FeedbackLine>;
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
