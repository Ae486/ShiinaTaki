/**
 * INPUT: page-local MCP draft, validation error, save/cancel callbacks and the save-in-flight flag
 * OUTPUT: stdio/http desired-config form whose stored secrets remain empty write-only placeholders
 * POS: Home MCP presentation editor; state validates and the controller owns transport/authority. Batch-2:
 *      every field rides the shared Field (visible focus ring, explicit labels — including the env/header
 *      pair), KindPicker rides SelectionTile (aria-pressed), the error rides FeedbackLine, and saving shows
 *      a pending state (A6).
 */

import { Badge } from "../../badge.tsx";
import { ActionButton } from "../../action-button.tsx";
import { SelectionTile } from "@/components/ui/selection-tile.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { nextFieldId, type McpFieldDraft, type McpServerDraft } from "./mcp-state.ts";

const LABEL = "text-xs font-medium text-text-secondary";

export function McpServerEditor(input: {
  draft: McpServerDraft;
  onChange(next: McpServerDraft): void;
  onCancel(): void;
  onSave(): void;
  error: string | null;
  editing: boolean;
  saving: boolean;
}) {
  const { draft } = input;
  const patch = (next: Partial<McpServerDraft>): void => input.onChange({ ...draft, ...next });
  return (
    <section className="rounded-xl border border-accent-border bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-strong">{input.editing ? `编辑 ${draft.serverId}` : "添加 MCP 服务器"}</h2>
        <Badge tone="muted">期望状态（保存后立即生效）</Badge>
      </div>
      <div className="grid gap-3">
        <Field label="服务器 ID（工具名前缀，创建后不可改）">
          <input className={FIELD_CONTROL} value={draft.serverId} disabled={input.editing} onChange={(event) => patch({ serverId: event.target.value })} placeholder="github" />
        </Field>
        <KindPicker draft={draft} patch={patch} />
        {draft.kind === "stdio" ? <StdioFields draft={draft} patch={patch} /> : <HttpFields draft={draft} patch={patch} />}
        <FieldRows draft={draft} patch={patch} />
        <Field label="选定工具（可选；每行一个原始工具名，留空 = 全部）">
          <textarea className={`${FIELD_CONTROL} font-mono`} rows={2} value={draft.selectedTools} onChange={(event) => patch({ selectedTools: event.target.value })} />
        </Field>
        {input.error && <FeedbackLine tone="danger">{input.error}</FeedbackLine>}
        <div className="flex justify-end gap-2">
          <ActionButton onClick={input.onCancel}>取消</ActionButton>
          <ActionButton tone="primary" busy={input.saving} disabled={input.saving} onClick={input.onSave}>
            {input.saving ? "保存中…" : "保存"}
          </ActionButton>
        </div>
      </div>
    </section>
  );
}

function KindPicker({ draft, patch }: { draft: McpServerDraft; patch(next: Partial<McpServerDraft>): void }) {
  return (
    <div className="flex gap-2" role="group" aria-label="传输类型">
      {(["stdio", "http"] as const).map((kind) => (
        <SelectionTile
          key={kind}
          selected={draft.kind === kind}
          onSelect={() => patch({ kind })}
        >
          {kind === "stdio" ? "stdio（本地进程）" : "http（远程端点）"}
        </SelectionTile>
      ))}
    </div>
  );
}

function StdioFields({ draft, patch }: { draft: McpServerDraft; patch(next: Partial<McpServerDraft>): void }) {
  return (
    <>
      <Field label="命令（可执行文件）">
        <input className={FIELD_CONTROL} value={draft.command} onChange={(event) => patch({ command: event.target.value })} placeholder="node" />
      </Field>
      <Field label="参数（每行一个）">
        <textarea className={`${FIELD_CONTROL} font-mono`} rows={2} value={draft.args} onChange={(event) => patch({ args: event.target.value })} placeholder={"server.mjs"} />
      </Field>
      <Field label="工作目录（可选）">
        <input className={FIELD_CONTROL} value={draft.cwd} onChange={(event) => patch({ cwd: event.target.value })} />
      </Field>
    </>
  );
}

function HttpFields({ draft, patch }: { draft: McpServerDraft; patch(next: Partial<McpServerDraft>): void }) {
  return (
    <Field label="URL">
      <input className={FIELD_CONTROL} value={draft.url} onChange={(event) => patch({ url: event.target.value })} placeholder="https://mcp.example.com/mcp" />
    </Field>
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
          <Field label="名称">
            <input className={`${FIELD_CONTROL} max-w-[160px]`} value={field.name} onChange={(event) => patchField(field.id, { name: event.target.value })} placeholder="TOKEN" />
          </Field>
          <Field label="密钥值">
            <input
              className={`${FIELD_CONTROL} flex-1`}
              type="password"
              autoComplete="off"
              value={field.value}
              placeholder={field.storedSecretRef ? "已加密存储 — 输入新值以更换" : "输入密钥值（只写不读）"}
              onChange={(event) => patchField(field.id, { value: event.target.value })}
            />
          </Field>
          <ActionButton tone="danger-soft" onClick={() => patch({ fields: draft.fields.filter((candidate) => candidate.id !== field.id) })}>删除</ActionButton>
        </div>
      ))}
      <div>
        <ActionButton onClick={() => patch({ fields: [...draft.fields, { id: nextFieldId(), name: "", value: "", storedSecretRef: null }] })}>
          添加字段
        </ActionButton>
      </div>
    </div>
  );
}
