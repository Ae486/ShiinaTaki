/**
 * INPUT:  a timeline-history reader (the chat client) + characterId + an output stream
 * OUTPUT: showRecentHistory({reader, characterId, output}) -> prints the last few turns oldest-first
 * POS:    cli — the AC-2 "history replay" demo: fetch + render recent timeline after auth (no OS access)
 */
import type { TimelineEntry, TimelineHistoryParams, TimelineHistoryResult } from "@taki/shared";

const RECENT_LIMIT = 5;

export interface TimelineReader {
  history(params: TimelineHistoryParams): Promise<TimelineHistoryResult>;
}

export interface ShowRecentHistoryArgs {
  reader: TimelineReader;
  characterId: string;
  output: NodeJS.WritableStream;
}

export async function showRecentHistory(args: ShowRecentHistoryArgs): Promise<void> {
  const { reader, characterId, output } = args;
  const { entries } = await reader.history({ characterId, limit: RECENT_LIMIT });
  if (entries.length === 0) return;
  output.write(`--- last ${entries.length} message(s) ---\n`);
  // history() returns newest-first; print oldest-first so the replay reads chronologically.
  for (const entry of [...entries].reverse()) output.write(formatEntry(entry));
}

function formatEntry(entry: TimelineEntry): string {
  return `${entry.role}: ${entry.content}\n`;
}
