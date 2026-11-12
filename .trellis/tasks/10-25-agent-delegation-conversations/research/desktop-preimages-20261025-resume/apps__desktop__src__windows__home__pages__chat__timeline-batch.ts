/**
 * INPUT:  trusted Timeline rows from history, append notifications and a complete turn commit
 * OUTPUT: seq-keyed canonical merges and exact presentation-batch coverage checks
 * POS:    ui/chat — view reconciliation only; a partial page never certifies a complete persisted turn
 */
import { sanitizeTimelinePresentations, type TimelineCommitted, type TimelineEntry } from "@taki/shared";

export function mergeTimelineEntries(existing: readonly TimelineEntry[], incoming: readonly TimelineEntry[]): TimelineEntry[] {
  const bySeq = new Map<number, TimelineEntry>();
  for (const entry of [...existing, ...incoming]) bySeq.set(entry.seq, entry);
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

export function completeTimelineBatch(entries: readonly TimelineEntry[], messageId: string): TimelineCommitted | null {
  const batch = entries.flatMap((entry) => entry.presentation?.messageId === messageId ? [{ entry, view: entry.presentation }] : [])
    .sort((left, right) => left.view.entryIndex - right.view.entryIndex);
  const first = batch[0];
  const view = first?.view;
  if (!first || !view || view.entryCount !== batch.length || new Set(batch.map(({ entry }) => entry.seq)).size !== batch.length) return null;
  if (batch.some((row, index) => row.entry.characterId !== first.entry.characterId || row.view.entryIndex !== index
    || row.view.entryCount !== view.entryCount || row.view.activitySeq !== view.activitySeq)) return null;
  return { characterId: first.entry.characterId, messageId, activitySeq: view.activitySeq,
    entries: sanitizeTimelinePresentations(batch.map((row) => row.entry)) };
}

/** A missing earlier prefix is page-recoverable; once index zero is present, a hole must not trigger endless paging. */
export function needsEarlierBatchPage(entries: readonly TimelineEntry[], messageIds: ReadonlySet<string>): boolean {
  for (const messageId of messageIds) {
    const rows = entries.filter((entry) => entry.presentation?.messageId === messageId);
    if (rows.length > 0 && !completeTimelineBatch(rows, messageId)
      && rows.every((entry) => (entry.presentation?.entryIndex ?? 0) > 0)) return true;
  }
  return false;
}
