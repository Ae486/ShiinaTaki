/**
 * INPUT:  selected scope, current Core configuration view and explicit read actions
 * OUTPUT: desired-versus-API configuration card with partial coverage and safe failure states
 * POS:    ui/windows/home/pages/operations — presentation only, no health or setup decisions
 */
import { useState } from "react";
import type { HindsightConfigurationScope, HindsightConfigurationStatus } from "@taki/shared";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { COMPARISON_LABEL, configurationNotice, configurationRows } from "./hindsight-configuration-state.ts";
import { useConfigurationCharacters } from "./use-configuration-characters.ts";
import { useHindsightConfiguration, type HindsightConfigurationView } from "./use-hindsight-configuration.ts";

export function HindsightConfigurationSection() {
  const [scope, setScope] = useState<HindsightConfigurationScope>({ kind: "global" });
  const roster = useConfigurationCharacters();
  const view = useHindsightConfiguration(scope);
  return <HindsightConfigurationCard view={view} scope={scope} select={setScope} characters={roster.characters} rosterFailed={roster.failed} retryRoster={roster.retry} />;
}

interface CardProps {
  view: HindsightConfigurationView;
  scope: HindsightConfigurationScope;
  select(scope: HindsightConfigurationScope): void;
  characters: string[];
  rosterFailed: boolean;
  retryRoster(): void;
}

export function HindsightConfigurationCard({ view, scope, select, characters, rosterFailed, retryRoster }: CardProps) {
  const busy = view.state.kind === "loading" || view.state.kind === "observing";
  const selected = scope.kind === "global" ? "global" : `character:${scope.characterId}`;
  return <PageCard title="Hindsight 模型配置观测">
    <p className="mb-3 text-xs text-text-secondary">仅覆盖响应的 API 进程。其他 API 副本、后台 Worker、嵌入和重排配置均未知。</p>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <label className="text-xs text-text-body">观测范围
        <select aria-label="观测范围" className="ml-2 rounded border border-border bg-surface px-2 py-1" value={selected}
          disabled={!view.connectionReady} onChange={(event) => select(event.target.value === "global" ? { kind: "global" }
            : { kind: "character", characterId: event.target.value.slice("character:".length) })}>
          <option value="global">全局（Global）</option>
          {scope.kind === "character" && !characters.includes(scope.characterId) && <option value={selected}>角色 · {scope.characterId}（列表不可用）</option>}
          {characters.map((id) => <option key={id} value={`character:${id}`}>角色 · {id}</option>)}
        </select>
      </label>
      <ActionButton disabled={!view.connectionReady || busy} busy={view.state.kind === "observing"} onClick={() => void view.observe()}>重新观测配置</ActionButton>
      <ActionButton tone="ghost" disabled={!view.connectionReady || busy} busy={view.state.kind === "loading"} onClick={() => void view.refresh()}>刷新 Core 状态</ActionButton>
    </div>
    {rosterFailed && <FeedbackLine tone="warn" action={{ label: "重试角色列表", onClick: retryRoster }}>角色列表读取失败；可继续观测全局范围。</FeedbackLine>}
    <ConfigurationBody view={view} />
    <p className="mt-3 text-xs text-text-secondary">观测不会调用模型或修改配置。模型名是配置别名，不证明上游实际执行的模型；配置一致不代表连接健康或已可启用。健康检查请使用独立的连接校验。</p>
  </PageCard>;
}

function ConfigurationBody({ view }: { view: HindsightConfigurationView }) {
  if (!view.connectionReady) return <p role="status" className="text-xs text-text-secondary">等待 Core 连接；恢复后重新读取状态。</p>;
  if (view.state.kind === "failed") return <FeedbackLine tone="danger">读取配置状态失败，旧观测已隐藏。请重试。</FeedbackLine>;
  if (view.state.kind === "expired") return <FeedbackLine tone="warn">观测已过期。请重新观测。</FeedbackLine>;
  if (view.state.kind === "observing" || view.state.kind === "loading") return <p role="status" className="text-xs text-text-secondary">{view.state.kind === "observing" ? "正在读取 API 配置…" : "正在读取 Core 状态…"}</p>;
  if (view.state.kind !== "ready") return <p className="text-xs text-text-secondary">尚未读取配置状态。</p>;
  const data = view.state.data;
  return <div className="flex flex-col gap-3">
    <p role="status" className="text-xs text-text-body">{configurationNotice(data)}</p>
    {data.bankId && <p className="break-all text-xs text-text-secondary">Bank：{data.bankId}</p>}
    {data.status === "observed" && <p className="text-xs text-text-secondary">{data.identity === "pinned" ? "Bank 身份已核对。" : "Bank 身份尚未固定；此观测不能用于启用或切换。"} 这是短时观测，过期后需重新读取。</p>}
    <ConfigurationTable data={data} />
  </div>;
}

function ConfigurationTable({ data }: { data: HindsightConfigurationStatus }) {
  return <div className="overflow-x-auto"><table className="w-full table-fixed text-left text-xs">
    <caption className="sr-only">Taki 期望设置与 API 已观测配置对照</caption>
    <thead className="text-text-secondary"><tr><th className="p-2">配置项</th><th className="p-2">Taki 期望设置</th><th className="p-2">API 已观测配置</th><th className="w-20 p-2">对照</th></tr></thead>
    <tbody>{configurationRows(data).map((row) => <tr key={row.field} className="border-t border-border-subtle">
      <th scope="row" className="p-2 font-medium text-text-body">{row.label}</th>
      <td className="break-all p-2 text-text-body">{row.desired}</td><td className="break-all p-2 text-text-body">{row.actual}</td>
      <td className={`p-2 ${row.comparison === "mismatch" ? "font-semibold text-danger" : "text-text-secondary"}`}>{COMPARISON_LABEL[row.comparison]}</td>
    </tr>)}</tbody>
  </table></div>;
}
