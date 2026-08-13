/**
 * INPUT:  usePermissions generation-safe Core state and mutation actions.
 * OUTPUT: <PermissionSection> — truthful loading/reconnecting/failure/saved/conflict/refusal permission surface.
 * POS:    ui/windows/home/pages/settings — policy section placed before generic config knobs.
 */
import { ActionButton } from "../../action-button.tsx";
import { PageAlert } from "../../page-chrome.tsx";
import { PermissionCellsCard } from "./permission-cells-card.tsx";
import { PermissionLevelCard } from "./permission-level-card.tsx";
import { previousData } from "./permission-state.ts";
import { usePermissions } from "./use-permissions.ts";

export function PermissionSection() {
  const permissions = usePermissions();
  const data = previousData(permissions.state);
  const disconnected = !permissions.connectionReady;
  const pending = permissions.state.kind === "ready" ? permissions.state.pending : null;
  const feedback = permissions.state.kind === "ready" ? permissions.state.feedback : null;

  return (
    <section className="space-y-4" aria-label="权限治理">
      {disconnected && <PageAlert>正在重新连接。保留当前窗口内的最后一次视图，但不会重放任何权限修改。</PageAlert>}
      {permissions.state.kind === "loading" && !data && <p className="text-xs text-slate-400">正在从 Core 读取权限策略…</p>}
      {permissions.state.kind === "loading" && data && <p className="text-xs text-slate-400">正在刷新 Core 权限策略…</p>}
      {permissions.state.kind === "failure" && (
        <PageAlert>
          权限策略{permissions.state.failureKind === "validation" ? "校验" : "读取"}失败：{permissions.state.message}
          <span className="ml-2"><ActionButton tone="secondary" disabled={disconnected} onClick={() => void permissions.refresh()}>重试</ActionButton></span>
        </PageAlert>
      )}
      {feedback && (
        <p className={`text-xs ${feedback.kind === "saved" ? "text-emerald-700" : feedback.kind === "conflict" ? "text-amber-700" : "text-rose-700"}`}>
          {feedback.message}
        </p>
      )}
      {data && (
        <>
          <PermissionLevelCard data={data} disabled={disconnected} pending={pending !== null} onSetLevel={(level) => void permissions.setLevel(level)} />
          <PermissionCellsCard data={data} disabled={disconnected || pending !== null} pending={pending} onSet={(input) => void permissions.setCell(input)} />
        </>
      )}
    </section>
  );
}
