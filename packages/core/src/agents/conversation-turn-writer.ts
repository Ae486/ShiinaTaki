/**
 * INPUT:  canonical response messages, captured names, optional item references, and the single Timeline repository
 * OUTPUT: one validated transaction followed by legacy appends and an optional complete batch notification
 * POS:    core/agents — conversational write boundary; observers cannot change or partially expose durable truth
 */
import { captureToolDisplayNames, validTimelinePresentation, type SourceContext, type TimelineCommitted, type TimelineEntry, type TimelineItemReference } from "@taki/shared";
import type { AppendInput, TimelineRepo } from "../db/timeline-repo.ts";
import type { TurnEntryInput, TurnMessage } from "./turn-mapping.ts";
import { toPresentedTurnEntry } from "./turn-presentation.ts";

export interface TurnCommitInput {
  characterId: string;
  messages: TurnMessage[];
  toolDisplayNames?: Readonly<Record<string, string>>;
  /** Descriptive references to evidence actually supplied to this generation, without private bodies. */
  sourceContext?(messageIndex: number): SourceContext | undefined;
  presentation?: {
    messageId: string;
    activitySeq: number;
    references(row: TurnEntryInput, messageIndex: number): TimelineItemReference[];
  };
}
export interface TurnWriterDeps {
  repo: TimelineRepo;
  onAppend?: (entry: TimelineEntry) => void;
  onCommit?: (batch: TimelineCommitted) => void;
}

export function commitConversationTurn(deps: TurnWriterDeps, input: TurnCommitInput): TimelineEntry[] {
  const rows = prepareRows(input);
  const entries = deps.repo.appendBatch(rows);
  // All rows are already committed here. A failed/closed observer cannot suppress another observer or retry a write.
  for (const entry of entries) publish(() => deps.onAppend?.(entry));
  const presentation = input.presentation;
  if (presentation) publish(() => deps.onCommit?.({
    characterId: input.characterId, messageId: presentation.messageId,
    activitySeq: presentation.activitySeq, entries,
  }));
  return entries;
}

function prepareRows(input: TurnCommitInput): AppendInput[] {
  const names = captureToolDisplayNames(input.toolDisplayNames);
  const rows = input.messages.flatMap((message, index) => {
    const entry = toPresentedTurnEntry(message, names);
    const sourceContext = message.role === "assistant" ? input.sourceContext?.(index) : undefined;
    const row = entry && { ...entry, ...(sourceContext ? { sourceContext } : {}) };
    return row ? [{ row, index }] : [];
  });
  return rows.map(({ row, index }, entryIndex) => {
    if (!input.presentation) return { characterId: input.characterId, ...row };
    const presentation = validTimelinePresentation({
      schemaVersion: "timeline-presentation.v1", messageId: input.presentation.messageId,
      activitySeq: input.presentation.activitySeq, entryIndex, entryCount: rows.length,
      references: input.presentation.references(row, index),
    }, row);
    if (!presentation) throw new Error("invalid timeline presentation references");
    return { characterId: input.characterId, ...row, presentation };
  });
}

function publish(notify: () => void): void {
  try { notify(); } catch { /* Durable history repairs a missed notification; publication never retries execution. */ }
}
