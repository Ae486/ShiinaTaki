/**
 * INPUT:  the Core permission snapshot, Home connection readiness, and a level mutation callback.
 * OUTPUT: <PermissionLevelCard> — one truthful strict/standard/relaxed selector with generation and Host-floor notice.
 * POS:    ui/windows/home/pages/settings — presentation only; Core supplies all policy state and accepts mutations.
 *         The three tiles ride SelectionTile (batch-2: unified accent recipe, ring emphasis, aria-pressed).
 */
import type { PermissionLevel, PermissionCellsState } from "@taki/shared";
import { Badge } from "../../badge.tsx";
import { PageCard } from "../../page-card.tsx";
import { SelectionTile } from "@/components/ui/selection-tile.js";

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
      <p className="mb-3 text-xs leading-relaxed text-text-secondary">
        Core 是全局策略唯一写入方。Execution Host 会在最终边界重新分类并可进一步收紧；此页面不能解除 Host 本地、托管或硬约束。
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {LEVELS.map((item) => (
          <SelectionTile
            key={item.level}
            selected={props.data.level === item.level}
            disabled={props.disabled || props.pending || props.data.level === item.level}
            onSelect={() => props.onSetLevel(item.level)}
          >
            <span className="block text-xs font-semibold">{item.label}</span>
            <span className="mt-1 block text-xs leading-snug text-text-secondary">{item.detail}</span>
          </SelectionTile>
        ))}
      </div>
    </PageCard>
  );
}
