/**
 * INPUT:  disposable Run-list filter draft and the controller's bounded read action
 * OUTPUT: Chinese summary/initiator/state/time filters with explicit invalid-range feedback
 * POS:    ui/monitor — list query controls only; the trajectory toolbar separately searches loaded safe records
 */
import { useState, type FormEvent } from "react";
import type { RunInitiator, RunState } from "@taki/shared";
import type { MonitorFilters } from "./monitor-controller.ts";
import { INITIATOR_OPTIONS, STATE_OPTIONS } from "./monitor-labels.ts";
import css from "./monitor-workspace.module.css";

interface FilterProps { filters: MonitorFilters; pending: boolean; apply(filters: MonitorFilters): void }

export function MonitorRunFilters({ filters, pending, apply }: FilterProps) {
  const [draft, setDraft] = useState(filters);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const period = monitorFilterPeriod(from, to);
    setError(period.error);
    if (!period.error) apply({ ...draft, from: period.from, to: period.to });
  };
  return <form className={css.filterForm} onSubmit={submit} aria-label="筛选运行记录">
    <label>运行摘要<input type="search" maxLength={100} value={draft.text} placeholder="触发方式或摘要"
      onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></label>
    <div className={css.filterPair}>
      <label>发起方<select value={draft.initiator}
        onChange={(event) => setDraft({ ...draft, initiator: event.target.value as RunInitiator | "" })}>
        <option value="">全部</option>{INITIATOR_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>运行状态<select value={draft.state}
        onChange={(event) => setDraft({ ...draft, state: event.target.value as RunState | "" })}>
        <option value="">全部</option>{STATE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    <label>起始时间<input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
    <label>结束时间<input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={pending}>{pending ? "正在筛选…" : "应用筛选"}</button>
  </form>;
}

export function monitorFilterPeriod(from: string, to: string): { from?: string; to?: string; error: string | null } {
  const start = from ? new Date(from) : undefined;
  const end = to ? new Date(to) : undefined;
  if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime()))) {
    return { error: "请输入有效的起止时间。" };
  }
  if (start && end && start > end) return { error: "结束时间不能早于起始时间。" };
  return { from: start?.toISOString(), to: end?.toISOString(), error: null };
}
