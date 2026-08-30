/**
 * INPUT:  projected trajectory rows and inspector fields
 * OUTPUT: semantic Run/Attempt groups plus labeled copy controls for the explicitly opened developer inspector
 * POS:    ui/windows/home/pages/monitor — pure presentation helpers; opaque grouping keys are never rendered.
 *         Technical fields ride the shared CopyableRow (min-w-0 + truncate + labelled copy); the detail list
 *         clamps with min-w-0 so long values cannot blow the inspector layout (U4).
 */
import type { TrajectoryInspector, TrajectoryRow } from "@taki/shared";
import { CopyableRow } from "@/components/ui/copyable-row.js";

export interface TrajectoryGroup {
  key: string;
  label: string;
  rows: TrajectoryRow[];
}

export function groupTrajectoryRows(rows: TrajectoryRow[]): TrajectoryGroup[] {
  const groups: TrajectoryGroup[] = [];
  for (const row of rows) {
    const key = row.groupKey ?? "run";
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      group = { key, label: row.kind === "attempt" ? `Attempt ${row.attemptOrdinal}` : key === "run" ? "Run" : "Attempt", rows: [] };
      groups.push(group);
    } else if (group.label === "Attempt" && row.kind === "attempt") {
      group.label = `Attempt ${row.attemptOrdinal}`;
    }
    group.rows.push(row);
  }
  return groups;
}

export function InspectorFields({ inspector }: { inspector: TrajectoryInspector }) {
  return (
    <div className="flex flex-col gap-3">
      {inspector.detail.length > 0 && (
        <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
          {inspector.detail.map((field) => (
            <div key={field.label} className="contents">
              <dt className="text-text-secondary">{field.label}</dt>
              <dd className="min-w-0 truncate font-medium text-text-body">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-col gap-1.5 text-xs">
        {inspector.technical.map((field) => (
          <CopyableRow key={field.label} label={field.label} value={field.value} mono />
        ))}
      </div>
    </div>
  );
}
