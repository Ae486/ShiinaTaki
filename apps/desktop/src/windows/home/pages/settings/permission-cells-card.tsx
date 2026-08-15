/**
 * INPUT:  the complete Core permission cells snapshot and exact cell mutation callback.
 * OUTPUT: <PermissionCellsCard> — collapsed-by-default advanced cells grouped by canonical capability id.
 * POS:    ui/windows/home/pages/settings — expandable presentation over Core-returned state; no local policy table.
 */
import type { PermissionCellSetParams, PermissionCellState, PermissionCellsState, PermissionPosture } from "@taki/shared";
import { PageCard } from "../../page-card.tsx";
import { PermissionCellRow } from "./permission-cell-row.tsx";

export function PermissionCellsCard(props: {
  data: PermissionCellsState;
  disabled: boolean;
  pending: string | null;
  onSet(input: Pick<PermissionCellSetParams, "key" | "level" | "posture" | "secondConfirm">): void;
}) {
  const activeCells = props.data.cells.filter((cell) => cell.level === props.data.level);
  const groups = groupCells(activeCells);
  return (
    <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-slate-700">
        高级权限单元
        <span className="ml-2 text-xs font-normal text-slate-400">默认折叠 · 注册表 {props.data.registryRevision}</span>
      </summary>
      <div className="border-t border-slate-200 px-4 pb-4">
        {[...groups].map(([capabilityId, cells]) => (
          <div key={capabilityId} className="mt-4">
            <PageCard title={capabilityId}>
              <div className="-mx-4 -my-3">
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
