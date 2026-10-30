/**
 * INPUT: shared filter/conversation state and the shared filter setter.
 * OUTPUT: accessible kind, severity, conversation, local time range and text controls.
 * POS: Home QQ messages — filter presentation; debounce and query ownership stay in the shared controller.
 */

import type { ManagementController, ManagementState, RecordFilters } from "@qqmm/management-client";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { conversationChoiceLabel, toLocalInput } from "./qqmm-labels.ts";

type FilterProps = { state: ManagementState; controller: ManagementController };

export function QqmmFilters({ state, controller }: FilterProps) {
  const set = (patch: Partial<RecordFilters>) => controller.setFilters({ ...state.filters, ...patch });
  return (
    <section aria-label="筛选日志" className="grid grid-cols-2 gap-3 border-b border-border bg-surface-muted px-6 py-3 @xl:grid-cols-3">
      <Field label="类型">
        <select className={FIELD_CONTROL} value={state.filters.kind ?? ""} onChange={(event) => set({ kind: event.target.value as RecordFilters["kind"] || undefined })}>
          <option value="">全部类型</option><option value="message">消息</option><option value="summary">摘要</option><option value="tool_result">工具结果</option><option value="runtime">运行记录</option>
        </select>
      </Field>
      <Field label="级别">
        <select className={FIELD_CONTROL} value={state.filters.severity ?? ""} onChange={(event) => set({ severity: event.target.value as RecordFilters["severity"] || undefined })}>
          <option value="">全部级别</option><option value="info">信息</option><option value="warn">警告</option><option value="error">错误</option>
        </select>
      </Field>
      <Field label="会话">
        <select className={FIELD_CONTROL} value={state.filters.conversationRef ?? ""} onChange={(event) => set({ conversationRef: event.target.value || undefined })}>
          <option value="">全部会话</option>
          {state.filters.conversationRef && !state.conversations.some((item) => item.conversationRef === state.filters.conversationRef) && <option value={state.filters.conversationRef}>当前会话</option>}
          {state.conversations.map((item) => <option key={item.conversationRef} value={item.conversationRef}>{conversationChoiceLabel(item, state.conversations)}</option>)}
        </select>
      </Field>
      <TimeFilters filters={state.filters} set={set} />
      <Field label="搜索内容">
        <input className={FIELD_CONTROL} type="search" maxLength={256} value={state.filters.search ?? ""} placeholder="输入关键词" onChange={(event) => set({ search: event.target.value || undefined })} />
      </Field>
    </section>
  );
}

function TimeFilters({ filters, set }: { filters: RecordFilters; set(patch: Partial<RecordFilters>): void }) {
  return <>
    <Field label="开始时间">
      <input className={FIELD_CONTROL} type="datetime-local" value={toLocalInput(filters.from)} max={toLocalInput(filters.to)} onChange={(event) => set({ from: event.target.value ? new Date(event.target.value).getTime() : undefined })} />
    </Field>
    <Field label="结束时间">
      <input className={FIELD_CONTROL} type="datetime-local" value={toLocalInput(filters.to)} min={toLocalInput(filters.from)} onChange={(event) => set({ to: event.target.value ? new Date(event.target.value).getTime() : undefined })} />
    </Field>
  </>;
}
