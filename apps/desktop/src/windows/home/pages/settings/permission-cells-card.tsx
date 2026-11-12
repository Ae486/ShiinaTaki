/**
 * INPUT:  the complete Core permission cells snapshot and exact cell mutation callback.
 * OUTPUT: <PermissionCellsCard> — collapsed advanced cells with Shared capability labels and internal canonical keys.
 * POS:    ui/windows/home/pages/settings — expandable presentation over Core-returned state; no local policy table.
 */
import { getCapabilityLabel, type PermissionCellSetParams, type PermissionCellState, type PermissionCellsState, type PermissionPosture } from "@taki/shared";
import { PageCard } from "../../page-card.tsx";
import { PermissionCellRow } from "./permission-cell-row.tsx";

export function PermissionCellsCard(props: {
  data: PermissionCellsState;
  disabled: boolean;
  pending: string | null;
  onInspect?(): void;
  onSet(input: Pick<PermissionCellSetParams, "key" | "level" | "posture" | "secondConfirm">): void;
}) {
  const activeCells = props.data.cells.filter((cell) => cell.level === props.data.level);
  const groups = groupCells(activeCells);
  return (
    <details className="rounded-xl border border-border bg-surface shadow-card" onToggle={(event) => {
      if (event.currentTarget.open) props.onInspect?.();
    }}>
      <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-text-body">
        高级权限设置
        <span className="ml-2 text-xs font-normal text-text-secondary">默认折叠</span>
      </summary>
      <div className="border-t border-border px-4 pb-4">
        {[...groups].map(([capabilityId, cells]) => (
          <div key={capabilityId} className="mt-4">
            <PageCard title={getCapabilityLabel(capabilityId)}>
              {/* Batch-2 §1: the bleed now matches the shared CARD_ROW step the knob rows use. */}
              <div className="-mx-5 -my-3.5">
              {cells.map((cell) => (
                <PermissionCellRow
                  key={cell.key}
                  cell={cell}
                  policyGeneration={props.data.policyGeneration}
                  disabled={props.disabled}
                  pending={props.pending === cell.key}
                  onSet={(posture: PermissionPosture | null, secondConfirm?: boolean) =>
                    props.onSet({ key: cell.key, level: cell.level, posture, secondConfirm })
                  }
                />
              ))}
              </div>
            </PageCard>
          </div>
        ))}
      </div>
    </details>
  );
}

function groupCells(cells: PermissionCellState[]): Map<string, PermissionCellState[]> {
  const groups = new Map<string, PermissionCellState[]>();
  for (const cell of cells) groups.set(cell.capabilityId, [...(groups.get(cell.capabilityId) ?? []), cell]);
  return groups;
}
