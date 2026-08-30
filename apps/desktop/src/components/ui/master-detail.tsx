/**
 * INPUT:  list/detail ReactNode slots (+ the container-query step at which the panes sit side by side).
 * OUTPUT: <MasterDetail> — the ONE two-pane layout shell: a narrow list aside plus a min-w-0 detail column that
 *         stack vertically while the container is narrower than the breakpoint.
 * POS:    ui/components — the L2 layout primitive (batch-4 MCP + Skills pages; batch-5 monitor three-zone nests its
 *         ledger/inspector row inside the detail slot). Pure layout: no data, state, selection or scroll ownership.
 */

import type { ReactNode } from "react";

// Complete class literals per step so Tailwind's scanner sees every generated variant (no dynamic class strings).
const BREAKPOINT_PANES = {
  "@xl": { row: "@xl:flex-row @xl:items-start", aside: "@xl:w-60 @xl:shrink-0" },
  "@3xl": { row: "@3xl:flex-row @3xl:items-start", aside: "@3xl:w-60 @3xl:shrink-0" },
} as const;

export type MasterDetailBreakpoint = keyof typeof BREAKPOINT_PANES;

export function MasterDetail({ list, detail, breakpoint = "@xl" }: {
  list: ReactNode;
  detail: ReactNode;
  breakpoint?: MasterDetailBreakpoint;
}) {
  const panes = BREAKPOINT_PANES[breakpoint];
  return (
    <div className={`@container flex flex-col gap-4 ${panes.row}`}>
      <aside className={panes.aside}>{list}</aside>
      <div className="flex min-w-0 flex-1 flex-col gap-4">{detail}</div>
    </div>
  );
}
