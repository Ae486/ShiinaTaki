/**
 * INPUT:  the Core permission snapshot, Home connection readiness, and a level mutation callback.
 * OUTPUT: <PermissionLevelCard> — one truthful strict/standard/relaxed selector with generation and Host-floor notice.
 * POS:    ui/windows/home/pages/settings — presentation only; Core supplies all policy state and accepts mutations.
 */
import type { PermissionLevel, PermissionCellsState } from "@taki/shared";
import { Badge } from "../../badge.tsx";
import { PageCard } from "../../page-card.tsx";

const LEVELS: Array<{ level: PermissionLevel; label: string; detail: string }> = [
  { level: "strict", label: "严格", detail: "更多操作需要批准或被拒绝" },
  { level: "standard", label: "标准", detail: "默认平衡安全与便利" },
  { level: "relaxed", label: "宽松", detail: "Core 允许更多自动执行，但不可绕过硬约束" },
];

export function PermissionLevelCard(props: {
  data: PermissionCellsState;
  disabled: boolean;
  pending: boolean;
  onSetLevel(level: PermissionLevel): void;
}) {
  return (
    <PageCard
      title="权限级别"
      action={<Badge tone="neutral">策略代次 {props.data.policyGeneration}</Badge>}
    >
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        Core 是全局策略唯一写入方。Execution Host 会在最终边界重新分类并可进一步收紧；此页面不能解除 Host 本地、托管或硬约束。
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {LEVELS.map((item) => {
          const active = props.data.level === item.level;
          return (
            <button
              key={item.level}
              type="button"
              disabled={props.disabled || props.pending || active}
              onClick={() => props.onSetLevel(item.level)}
              aria-pressed={active}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                active ? "border-rose-300 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span className="block text-xs font-semibold">{item.label}</span>
              <span className="mt-1 block text-[11px] leading-snug text-slate-500">{item.detail}</span>
            </button>
          );
        })}
      </div>
    </PageCard>
  );
}
