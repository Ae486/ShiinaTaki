/**
 * INPUT:  the useMcpServers() view state (Core-authoritative desired + runtime truth) and editor drafts.
 * OUTPUT: <McpPage> — the MCP lifecycle management page: server cards with truthful phase/diagnostic badges,
 *         a write-only-secret editor, test/reconnect/enable/disable/remove actions, and the loading/empty/
 *         validation/partial-failure/reconnecting/success states the home conventions require.
 * POS:    ui/windows/home/pages/mcp — presentation only; every mutation goes through the controller, nothing is
 *         persisted locally (no storage or page-cache key for MCP state), and secret values are never echoed back.
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

export function McpPage() {
  const { state, connectionReady, refresh, add, edit, setEnabled, remove, reconnect, test } = useMcpServers();
  const [draft, setDraft] = useState<McpServerDraft | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const servers = state.kind === "ready" ? state.data : state.kind === "failure" ? state.previous : null;
  const busy = state.kind === "ready" && state.pending !== null;

  return (
    <>
      <PageHeader
        title="MCP 服务器"
        hint="期望状态存于 Core；添加/编辑/启停/移除即时生效，无需重启。密钥值只写入加密目录，绝不回显。"
        busy={state.kind === "loading" && servers !== null}
      />
      <PageBody>
        {state.kind === "failure" && <PageAlert>{state.failureKind === "validation" ? "Core 返回的 MCP 快照校验失败" : `读取 MCP 服务器失败：${state.message}`}</PageAlert>}
        {state.kind === "ready" && state.feedback && <FeedbackBanner feedback={state.feedback} />}
        {servers === null && state.kind === "loading" && <p className="text-xs text-slate-400">载入中…</p>}
        {servers !== null && servers.length === 0 && draft === null && <EmptyState disabled={!connectionReady} onAdd={() => setDraft(emptyDraft())} />}
        {draft !== null && (
          <McpServerEditor
            draft={draft}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={() => void saveDraft(draft, { editingRevision, servers, add, edit, setFormError, clearEditor: () => setDraft(null) })}
            error={formError}
            editing={editingRevision !== null}
          />
        )}
        <ServerList
          servers={servers}
          disabled={!connectionReady || busy}
          confirmRemove={confirmRemove}
          hooks={{ setConfirmRemove, setDraft, setEditingRevision, setFormError, setEnabled, remove, reconnect, test }}
        />
        {servers !== null && servers.length > 0 && draft === null && (
          <div className="flex justify-end gap-2">
            <ActionButton disabled={!connectionReady} onClick={() => void refresh()}>刷新</ActionButton>
            <ActionButton tone="primary" disabled={!connectionReady} onClick={() => setDraft(emptyDraft())}>添加服务器</ActionButton>
          </div>
        )}
      </PageBody>
    </>
  );
}

interface SaveInput {
  editingRevision: number | null;
  servers: McpServerView[] | null;
  add(draft: McpServerDraft): Promise<void>;
  edit(draft: McpServerDraft, expectedRevision: number): Promise<void>;
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
  if (editingRevision === null) await input.add(draft);
  else await input.edit(draft, editingRevision);
  input.clearEditor();
}

function FeedbackBanner({ feedback }: { feedback: McpFeedback }) {
  const tone = feedback.kind === "saved"
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
