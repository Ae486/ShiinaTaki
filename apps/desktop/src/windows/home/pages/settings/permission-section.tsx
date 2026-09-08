/**
 * INPUT:  usePermissions generation-safe Core state and mutation actions.
 * OUTPUT: retained permission cards with compact pending state and actionable persistent diagnostics.
 * POS:    Settings policy section; transient success belongs to its action-owned Toast, failed reads keep retry.
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
  const { pending, feedback } = permissions;
  const unavailable = disconnected || permissions.state.kind !== "ready";

  return (
    <section className="space-y-4" aria-label="权限治理">
      {disconnected && <FeedbackLine tone="warn">正在重新连接。保留当前窗口内的最后一次视图，但不会重放任何权限修改。</FeedbackLine>}
      {permissions.state.kind === "loading" && !data && <Skeleton lines={4} />}
      {permissions.state.kind === "failure" && (
        <PageAlert action={{ label: "重试", onClick: () => void permissions.refresh() }}>
          权限策略{permissions.state.failureKind === "validation" ? "校验" : "读取"}失败：{permissions.state.message}
        </PageAlert>
      )}
      {feedback && feedback.kind !== "saved" && (
        <FeedbackLine tone={feedback.kind === "conflict" ? "warn" : "danger"}>
          {feedback.message}
        </FeedbackLine>
      )}
      {data && (
        <>
          <PermissionLevelCard data={data} disabled={unavailable} pending={pending !== null}
            refreshing={permissions.state.kind === "loading"} onSetLevel={(level) => void permissions.setLevel(level)} />
          <PermissionCellsCard data={data} disabled={unavailable || pending !== null} pending={pending}
            onInspect={() => void permissions.refresh()} onSet={(input) => void permissions.setCell(input)} />
        </>
      )}
    </section>
  );
}
