/**
 * INPUT:  usePermissions generation-safe Core state and mutation actions.
 * OUTPUT: <PermissionSection> — truthful loading/reconnecting/failure/saved/conflict/refusal permission surface.
 * POS:    ui/windows/home/pages/settings — policy section placed before generic config knobs. Loading rides the
 *         shared Skeleton and outcome lines ride FeedbackLine (batch-2); the failed read keeps its retry.
 */
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { PageAlert } from "../../page-chrome.tsx";
import { Skeleton } from "@/components/ui/skeleton.js";
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
      {disconnected && <FeedbackLine tone="warn">正在重新连接。保留当前窗口内的最后一次视图，但不会重放任何权限修改。</FeedbackLine>}
      {permissions.state.kind === "loading" && !data && <Skeleton lines={4} />}
      {permissions.state.kind === "loading" && data && <FeedbackLine tone="info">正在刷新 Core 权限策略…</FeedbackLine>}
      {permissions.state.kind === "failure" && (
        <PageAlert action={{ label: "重试", onClick: () => void permissions.refresh() }}>
          权限策略{permissions.state.failureKind === "validation" ? "校验" : "读取"}失败：{permissions.state.message}
        </PageAlert>
      )}
      {feedback && (
        <FeedbackLine tone={feedback.kind === "saved" ? "ok" : feedback.kind === "conflict" ? "warn" : "danger"}>
          {feedback.message}
        </FeedbackLine>
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
