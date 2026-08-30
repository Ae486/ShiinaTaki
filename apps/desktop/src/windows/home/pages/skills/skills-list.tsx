/**
 * INPUT:  the Core Skill package views, the selected packageId, and the selection callback
 * OUTPUT: the master list pane (L2): one SelectionTile row per package — display name + runtime badge + a one-line
 *         description fact
 * POS:    ui/windows/home/pages/skills — batch-4 L2 master pane; selection is page memory, no transport ownership.
 */

import type { SkillPackageView } from "@taki/shared";
import { Badge } from "../../badge.tsx";
import { SelectionTile } from "@/components/ui/selection-tile.js";
import { REJECTED_PACKAGE_TITLE, runtimeLabel, runtimeTone } from "./skill-labels.ts";

export function SkillList(input: {
  rows: SkillPackageView[];
  selectedId: string | null;
  onSelect(packageId: string): void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {input.rows.map((row) => (
        <SelectionTile
          key={row.packageId}
          selected={row.packageId === input.selectedId}
          stateAttr="aria-current"
          onSelect={() => input.onSelect(row.packageId)}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{row.skillName ?? REJECTED_PACKAGE_TITLE}</span>
              <Badge tone={runtimeTone(row.runtimeState)}>{runtimeLabel(row.runtimeState)}</Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-text-secondary">{row.description ?? row.failureReason ?? "包未通过验证"}</p>
          </div>
        </SelectionTile>
      ))}
    </div>
  );
}
