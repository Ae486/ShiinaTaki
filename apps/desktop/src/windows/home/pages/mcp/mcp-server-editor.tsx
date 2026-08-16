/**
 * INPUT:  an McpServerDraft (page-local editor model) + change/cancel/save callbacks and a validation error line.
 * OUTPUT: <McpServerEditor> — the stdio/http desired-config form with write-only secret fields (a stored secret
 *         shows empty with a "已加密存储" placeholder; the value only ever travels via secret.set).
 * POS:    ui/windows/home/pages/mcp — presentation only; validation lives in mcp-state.ts and the write in the
 *         controller, so this file holds no transport or authority of its own.
 */

import { Badge } from "../../badge.tsx";
import { ActionButton } from "../../action-button.tsx";
import { nextFieldId, type McpFieldDraft, type McpServerDraft } from "./mcp-state.ts";

const FIELD = "w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-rose-200";
const LABEL = "text-[11px] font-medium text-slate-500";

export function McpServerEditor(input: {
  draft: McpServerDraft;
  onChange(next: McpServerDraft): void;
  onCancel(): void;
  onSave(): void;
  error: string | null;
  editing: boolean;
}) {
  const { draft } = input;
  const patch = (next: Partial<McpServerDraft>): void => input.onChange({ ...draft, ...next });
  return (
    <section className="rounded-xl border border-rose-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-slate-800">{input.editing ? `编辑 ${draft.serverId}` : "添加 MCP 服务器"}</h2>
        <Badge tone="muted">期望状态（保存后立即生效）</Badge>
      </div>
      <div className="grid gap-3">
        <label className="grid gap-1">
          <span className={LABEL}>服务器 ID（工具名前缀，创建后不可改）</span>
          <input className={FIELD} value={draft.serverId} disabled={input.editing} onChange={(event) => patch({ serverId: event.target.value })} placeholder="github" />
        </label>
        <KindPicker draft={draft} patch={patch} />
        {draft.kind === "stdio" ? <StdioFields draft={draft} patch={patch} /> : <HttpFields draft={draft} patch={patch} />}
        <FieldRows draft={draft} patch={patch} />
        <label className="grid gap-1">
          <span className={LABEL}>选定工具（可选；每行一个原始工具名，留空 = 全部）</span>
          <textarea className={`${FIELD} font-mono`} rows={2} value={draft.selectedTools} onChange={(event) => patch({ selectedTools: event.target.value })} />
        </label>
        {input.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-100">{input.error}</p>}
        <div className="flex justify-end gap-2">
          <ActionButton onClick={input.onCancel}>取消</ActionButton>
          <ActionButton tone="primary" onClick={input.onSave}>保存</ActionButton>
        </div>
      </div>
    </section>
  );
}

function KindPicker({ draft, patch }: { draft: McpServerDraft; patch(next: Partial<McpServerDraft>): void }) {
  return (
    <div className="flex gap-2">
      {(["stdio", "http"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => patch({ kind })}
          className={`rounded-md px-3 py-1 text-xs font-medium ring-1 transition-colors ${draft.kind === kind ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"}`}
        >
          {kind === "stdio" ? "stdio（本地进程）" : "http（远程端点）"}
        </button>
      ))}
    </div>
  );
}

function StdioFields({ draft, patch }: { draft: McpServerDraft; patch(next: Partial<McpServerDraft>): void }) {
  return (
    <>
      <label className="grid gap-1">
        <span className={LABEL}>命令（可执行文件）</span>
        <input className={FIELD} value={draft.command} onChange={(event) => patch({ command: event.target.value })} placeholder="node" />
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>参数（每行一个）</span>
        <textarea className={`${FIELD} font-mono`} rows={2} value={draft.args} onChange={(event) => patch({ args: event.target.value })} placeholder={"server.mjs"} />
      </label>
      <label className="grid gap-1">
        <span className={LABEL}>工作目录（可选）</span>
        <input className={FIELD} value={draft.cwd} onChange={(event) => patch({ cwd: event.target.value })} />
      </label>
    </>
  );
}

function HttpFields({ draft, patch }: { draft: McpServerDraft; patch(next: Partial<McpServerDraft>): void }) {
  return (
    <label className="grid gap-1">
      <span className={LABEL}>URL</span>
      <input className={FIELD} value={draft.url} onChange={(event) => patch({ url: event.target.value })} placeholder="https://mcp.example.com/mcp" />
    </label>
  );
}

/** Write-only secret fields: a stored secret renders empty with a "已加密存储" placeholder; the value only
 *  ever travels out via secret.set (the controller), never back from Core. */
function FieldRows({ draft, patch }: { draft: McpServerDraft; patch(next: Partial<McpServerDraft>): void }) {
  const patchField = (id: number, next: Partial<McpFieldDraft>): void => {
    patch({ fields: draft.fields.map((field) => (field.id === id ? { ...field, ...next } : field)) });
  };
  return (
    <div className="grid gap-2">
      <span className={LABEL}>{draft.kind === "stdio" ? "环境变量" : "请求头"}</span>
      {draft.fields.map((field) => (
        <div key={field.id} className="flex flex-wrap items-center gap-2">
          <input className={`${FIELD} max-w-[160px]`} value={field.name} onChange={(event) => patchField(field.id, { name: event.target.value })} placeholder="TOKEN" />
          <input
            className={`${FIELD} flex-1`}
            type="password"
            autoComplete="off"
            value={field.value}
            placeholder={field.hadSecret ? "已加密存储 — 输入新值以更换" : field.secret ? "输入密钥值（只写不读）" : "值"}
            onChange={(event) => patchField(field.id, { value: event.target.value })}
          />
          <label className="flex items-center gap-1 text-[11px] text-slate-500">
            <input type="checkbox" checked={field.secret} onChange={(event) => patchField(field.id, { secret: event.target.checked })} />
            密钥
          </label>
          <ActionButton tone="danger-soft" onClick={() => patch({ fields: draft.fields.filter((candidate) => candidate.id !== field.id) })}>删除</ActionButton>
        </div>
      ))}
      <div>
        <ActionButton onClick={() => patch({ fields: [...draft.fields, { id: nextFieldId(), name: "", value: "", secret: false, hadSecret: false }] })}>
          添加字段
        </ActionButton>
      </div>
    </div>
  );
}
