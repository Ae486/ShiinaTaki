/**
 * INPUT:  the Core permission snapshot, Home connection readiness, and a level mutation callback.
 * OUTPUT: <PermissionLevelCard> — one truthful strict/standard/relaxed selector with operator-facing safety limits.
 * POS:    ui/windows/home/pages/settings — presentation only; Core supplies all policy state and accepts mutations.
 *         The three tiles ride SelectionTile (batch-2: unified accent recipe, ring emphasis, aria-pressed).
 */
import type { PermissionLevel, PermissionCellsState } from "@taki/shared";
import { PageCard } from "../../page-card.tsx";
import { SelectionTile } from "@/components/ui/selection-tile.js";

const LEVELS: Array<{ level: PermissionLevel; label: string; detail: string }> = [
  { level: "strict", label: "严格", detail: "更多操作需要批准或被拒绝" },
  { level: "standard", label: "标准", detail: "默认平衡安全与便利" },
  { level: "relaxed", label: "宽松", detail: "允许更多自动执行，但仍受安全限制" },
];

export function PermissionLevelCard(props: {
  data: PermissionCellsState;
  disabled: boolean;
  pending: boolean;
  onSetLevel(level: PermissionLevel): void;
}) {
  return (
    <PageCard title="权限级别">
      <p className="mb-3 text-xs leading-relaxed text-text-secondary">
        设备本地限制、管理策略和固定安全规则始终生效，宽松级别也不能解除。
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
