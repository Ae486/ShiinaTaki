/**
 * INPUT: primary admission metadata, actual response messages, presentation references and local source/Timeline repos
 * OUTPUT: atomic source begin/retain/retract and post-commit Timeline notifications
 * POS: core/agents — conversational write boundary; observers cannot change or partially expose durable truth
 */
import { captureToolDisplayNames, validTimelinePresentation, type RunMemoryReference, type SourceContext, type TimelineCommitted, type TimelineEntry, type TimelineItemReference } from "@taki/shared";
import type { AppendInput, TimelineRepo } from "../db/timeline-repo.ts";
import type { PrimaryConversationSourceRepo } from "../db/primary-conversation-source-repo.ts";
import { toUserEntryInput, type TurnEntryInput, type TurnMessage, type UserImageInput } from "./turn-mapping.ts";
import { toPresentedTurnEntry } from "./turn-presentation.ts";

export interface TurnCommitInput {
  characterId: string;
  primarySourceId?: string;
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
  primarySources?: { repo: PrimaryConversationSourceRepo; afterCommit(callback: () => void): void };
  onAppend?: (entry: TimelineEntry) => void;
  onCommit?: (batch: TimelineCommitted) => void;
  onRemove?: (ref: { characterId: string; seq: number }) => void;
}

export interface PrimaryBeginInput {
  characterId: string; text: string; images?: UserImageInput[]; runId?: string; memory?: RunMemoryReference;
}

export function beginPrimaryConversation(deps: TurnWriterDeps, input: PrimaryBeginInput): { userEntry: TimelineEntry; sourceId?: string } {
  const user = { characterId: input.characterId, ...toUserEntryInput(input.text, input.images ?? []) };
  const result = deps.primarySources
    ? deps.primarySources.repo.begin({ user, runId: input.runId, memory: input.memory })
    : { userEntry: deps.repo.append(user) };
  publishTurnCommit(deps, () => deps.onAppend?.(result.userEntry));
  return result;
}

export function retractPrimaryConversation(deps: TurnWriterDeps, sourceId: string): void {
  if (!deps.primarySources) throw new Error("PRIMARY_SOURCE_WRITER_MISSING");
  const result = deps.primarySources.repo.retract(sourceId);
  const entry = result.userEntry;
  if (result.committed && entry) publishTurnCommit(deps, () => deps.onRemove?.({ characterId: entry.characterId, seq: entry.seq }));
}

export function commitConversationTurn(deps: TurnWriterDeps, input: TurnCommitInput): TimelineEntry[] {
  const rows = prepareRows(input);
  if (input.primarySourceId && !deps.primarySources) throw new Error("PRIMARY_SOURCE_WRITER_MISSING");
  const result = input.primarySourceId && deps.primarySources
    ? deps.primarySources.repo.retain({ sourceId: input.primarySourceId, rows })
    : { entries: deps.repo.appendBatch(rows), committed: true };
  const { entries } = result;
  if (!result.committed) return entries;
  // The source transaction may be nested: observers wait for the outer commit and never retry a write.
  for (const entry of entries) publishTurnCommit(deps, () => deps.onAppend?.(entry));
  const presentation = input.presentation;
  if (presentation) publishTurnCommit(deps, () => deps.onCommit?.({
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

export function publishTurnCommit(deps: TurnWriterDeps, notify: () => void): void {
  const publish = () => {
    try { notify(); } catch { /* Durable history repairs a missed notification; publication never retries execution. */ }
  };
  if (deps.primarySources) deps.primarySources.afterCommit(publish);
  else publish();
}
