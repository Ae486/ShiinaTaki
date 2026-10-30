/**
 * INPUT:  timeline entries (ascending by seq, i.e. chronological) from the chat timeline store.
 * OUTPUT: groupByLocalDate(entries) -> consecutive runs sharing a LOCAL calendar day, for date-divider rendering.
 * POS:    ui/windows/home/pages/chat — a pure grouping helper (no React/WS). The timeline view renders one divider per group.
 */

import type { TimelineEntry } from "@taki/shared";

export interface DateGroup<Entry = TimelineEntry> {
  /** Local calendar day (YYYY-MM-DD) — a stable, timezone-correct divider key/label. */
  dateKey: string;
  entries: Entry[];
}

// The LOCAL calendar day of an ISO timestamp — the date-divider boundary the user actually reads (not UTC).
export function localDateKey(createdAt: string): string {
  const date = new Date(createdAt);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Groups CONSECUTIVE entries by local day; correct because the input is already chronological (append-only seq). */
export function groupByLocalDate<Entry extends { createdAt: string }>(entries: Entry[]): DateGroup<Entry>[] {
  const groups: DateGroup<Entry>[] = [];
  for (const entry of entries) {
    const dateKey = localDateKey(entry.createdAt);
    const last = groups.at(-1);
    if (last && last.dateKey === dateKey) last.entries.push(entry);
    else groups.push({ dateKey, entries: [entry] });
  }
  return groups;
}
