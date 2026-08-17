/**
 * INPUT: Core-authoritative MCP view state and page-local editor drafts
 * OUTPUT: lifecycle management page with complete states, server actions, and write-only-secret editing
 * POS: Home MCP presentation; controller owns mutations, no MCP truth is persisted locally or echoed
 */

import { useState } from "react";
import type { McpServerView } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { PageCard } from "../../page-card.tsx";
import { draftFromView, emptyDraft, validateDraft, type McpFeedback, type McpServerDraft } from "./mcp-state.ts";
import { useMcpServers } from "./use-mcp.ts";
import { McpServerCard } from "./mcp-server-card.tsx";
import { McpServerEditor } from "./mcp-server-editor.tsx";
import type { McpEditorMutationResult } from "./mcp-controller.ts";

export function McpPage() {
  const mcp = useMcpServers();
  const [draft, setDraft] = useState<McpServerDraft | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
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

  return (
    <>
      <PageHeader
        title="MCP 服务器"
        hint="期望状态存于 Core；添加/编辑/启停/移除即时生效，无需重启。密钥值只写入加密目录，绝不回显。"
        busy={mcp.state.kind === "loading" && mcp.state.previous !== null}
      />
      <McpPageBody input={{
        mcp, draft, editingRevision, confirmRemove, formError,
        setDraft, setEditingRevision, setConfirmRemove, setFormError,
        clearEditor, startAdd,
      }} />
    </>
  );
}

interface McpPageBodyInput {
  mcp: ReturnType<typeof useMcpServers>;
  draft: McpServerDraft | null;
  editingRevision: number | null;
  confirmRemove: string | null;
  formError: string | null;
  setDraft(draft: McpServerDraft | null): void;
  setEditingRevision(revision: number | null): void;
  setConfirmRemove(id: string | null): void;
  setFormError(error: string | null): void;
  clearEditor(): void;
  startAdd(): void;
}

function McpPageBody({ input }: { input: McpPageBodyInput }) {
  const { mcp, draft } = input;
  const servers = mcp.state.kind === "ready" ? mcp.state.data : mcp.state.kind === "failure" ? mcp.state.previous : null;
  const busy = mcp.state.kind === "ready" && mcp.state.pending !== null;
  return (
    <PageBody>
      {mcp.state.kind === "failure" && <PageAlert>{mcp.state.failureKind === "validation" ? "Core 返回的 MCP 快照校验失败" : `读取 MCP 服务器失败：${mcp.state.message}`}</PageAlert>}
      {mcp.state.kind === "ready" && mcp.state.feedback && <FeedbackBanner feedback={mcp.state.feedback} />}
      {servers === null && mcp.state.kind === "loading" && <p className="text-xs text-slate-400">载入中…</p>}
      {servers !== null && servers.length === 0 && draft === null && <EmptyState disabled={!mcp.connectionReady} onAdd={input.startAdd} />}
      {draft !== null && <McpServerEditor
        draft={draft}
        onChange={input.setDraft}
        onCancel={input.clearEditor}
        onSave={() => void saveDraft(draft, {
          editingRevision: input.editingRevision, servers, add: mcp.add, edit: mcp.edit,
          setEditingRevision: input.setEditingRevision, setFormError: input.setFormError,
          clearEditor: input.clearEditor,
        })}
        error={input.formError}
        editing={input.editingRevision !== null}
      />}
      <ServerList
        servers={servers}
        disabled={!mcp.connectionReady || busy}
        confirmRemove={input.confirmRemove}
        hooks={{ ...input, setEnabled: mcp.setEnabled, remove: mcp.remove, reconnect: mcp.reconnect, test: mcp.test }}
      />
      {servers !== null && servers.length > 0 && draft === null && <div className="flex justify-end gap-2">
        <ActionButton disabled={!mcp.connectionReady} onClick={() => void mcp.refresh()}>刷新</ActionButton>
        <ActionButton tone="primary" disabled={!mcp.connectionReady} onClick={input.startAdd}>添加服务器</ActionButton>
      </div>}
    </PageBody>
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
    ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
    : feedback.kind === "conflict"
      ? "bg-amber-50 text-amber-700 ring-amber-100"
      : "bg-rose-50 text-rose-700 ring-rose-100";
  return <p className={`rounded-lg px-3 py-2 text-xs ring-1 ${tone}`}>{feedback.message}</p>;
}

function EmptyState({ disabled, onAdd }: { disabled: boolean; onAdd(): void }) {
  return (
    <PageCard title="尚未配置 MCP 服务器">
      <p className="text-xs text-slate-500">添加第一个服务器后，Core 会连接它并把工具纳入治理管控。</p>
      <div className="mt-3"><ActionButton tone="primary" disabled={disabled} onClick={onAdd}>添加服务器</ActionButton></div>
    </PageCard>
  );
}

interface ServerListHooks {
  setConfirmRemove(id: string | null): void;
  setDraft(draft: McpServerDraft | null): void;
  setEditingRevision(revision: number | null): void;
  setFormError(error: string | null): void;
  setEnabled(input: { serverId: string; enabled: boolean; expectedRevision: number }): Promise<void>;
  remove(input: { serverId: string; expectedRevision: number }): Promise<void>;
  reconnect(serverId: string): Promise<void>;
  test(serverId: string): Promise<void>;
}

/** The per-server cards plus the page-level list actions; kept out of McpPage for the size caps. */
function ServerList(input: { servers: McpServerView[] | null; disabled: boolean; confirmRemove: string | null; hooks: ServerListHooks }) {
  const { servers, disabled, confirmRemove, hooks } = input;
  if (servers === null) return null;
  return (
    <>
      {servers.map((server) => (
        <McpServerCard
          key={server.serverId}
          server={server}
          disabled={disabled}
          confirmRemove={confirmRemove === server.serverId}
          onAskRemove={() => hooks.setConfirmRemove(server.serverId)}
          onCancelRemove={() => hooks.setConfirmRemove(null)}
          onConfirmRemove={() => {
            hooks.setConfirmRemove(null);
            void hooks.remove({ serverId: server.serverId, expectedRevision: server.configRevision });
          }}
          onToggleEnabled={() => void hooks.setEnabled({ serverId: server.serverId, enabled: !server.enabled, expectedRevision: server.configRevision })}
          onEdit={() => { hooks.setDraft(draftFromView(server)); hooks.setEditingRevision(server.configRevision); hooks.setFormError(null); }}
          onReconnect={() => void hooks.reconnect(server.serverId)}
          onTest={() => void hooks.test(server.serverId)}
        />
      ))}
    </>
  );
}
