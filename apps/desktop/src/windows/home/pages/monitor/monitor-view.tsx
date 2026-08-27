/**
 * INPUT:  projected trajectory rows and inspector fields
 * OUTPUT: semantic Run/Attempt groups plus labeled copy controls for the explicitly opened developer inspector
 * POS:    ui/windows/home/pages/monitor — pure presentation helpers; opaque grouping keys are never rendered
 */
import type { TrajectoryInspector, TrajectoryRow } from "@taki/shared";

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
      {inspector.detail.length > 0 && <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
        {inspector.detail.map((field) => <div key={field.label} className="contents"><dt className="text-slate-500">{field.label}</dt><dd className="font-medium text-slate-700">{field.value}</dd></div>)}
      </dl>}
      <dl className="flex flex-col gap-1.5 text-xs">
        {inspector.technical.map((field) => <div key={field.label} className="flex items-center justify-between gap-3 rounded border border-slate-100 px-2 py-1.5">
          <div className="min-w-0"><dt className="text-slate-500">{field.label}</dt><dd className="truncate font-mono text-slate-700">{field.value}</dd></div>
          <button type="button" aria-label={`复制 ${field.label}`} className="shrink-0 rounded px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100" onClick={() => void navigator.clipboard.writeText(field.value).catch(() => undefined)}>复制</button>
        </div>)}
      </dl>
    </div>
  );
}
