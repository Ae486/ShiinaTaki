/**
 * INPUT:  one current client, pending-message anchors and the previously known canonical tail
 * OUTPUT: newest history plus bounded missing coverage and complete pending turn batches
 * POS:    ui/chat — read-only recovery; known anchors and monotonic Core cursors avoid unrelated history scans
 */
import { TIMELINE_HISTORY_LIMIT_DEFAULT, TIMELINE_HISTORY_LIMIT_MAX, type TimelineHistoryResult } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { completeTimelineBatch, mergeTimelineEntries, needsEarlierBatchPage } from "./timeline-batch.ts";

interface HistoryReadInput {
  client: Pick<WsClient, "timelineHistory">;
  characterId: string;
  messageIds: ReadonlySet<string>;
  /** Previously visible pending turns can be wholly absent from the newest page, but cannot precede their anchors. */
  messageAnchors?: ReadonlyMap<string, number>;
  /** Reconnect must bridge back to the old canonical tail before keeping its older-page cursor. */
  afterSeq?: number;
  isCurrent(): boolean;
}

export async function readChatHistory(input: HistoryReadInput): Promise<TimelineHistoryResult> {
  if (!input.isCurrent()) return { entries: [], nextBefore: null };
  let page = await input.client.timelineHistory({ characterId: input.characterId, limit: TIMELINE_HISTORY_LIMIT_DEFAULT });
  validateCharacter(page, input.characterId);
  let entries = page.entries;
  while (input.isCurrent() && page.nextBefore !== null && needsCoverage(entries, page.nextBefore, input)) {
    const before = page.nextBefore;
    page = await input.client.timelineHistory({ characterId: input.characterId, before, limit: TIMELINE_HISTORY_LIMIT_MAX });
    validateCharacter(page, input.characterId);
    entries = mergeTimelineEntries(entries, page.entries).reverse();
    if (page.entries.length === 0 || (page.nextBefore !== null && page.nextBefore >= before)) break;
  }
  return { entries, nextBefore: page.nextBefore };
}

function needsCoverage(entries: TimelineHistoryResult["entries"], before: number, input: HistoryReadInput): boolean {
  const remaining = new Set([...input.messageIds].filter((messageId) => {
    const anchor = input.messageAnchors?.get(messageId);
    return anchor === undefined || before > anchor;
  }));
  if (needsEarlierBatchPage(entries, remaining)) return true;
  if (input.afterSeq !== undefined && before > input.afterSeq) return true;
  for (const [messageId, anchor] of input.messageAnchors ?? []) {
    if (before > anchor && !completeTimelineBatch(entries, messageId)) return true;
  }
  return false;
}

function validateCharacter(page: TimelineHistoryResult, characterId: string): void {
  if (page.entries.some((entry) => entry.characterId !== characterId)) throw new Error("Timeline page Character mismatch");
}
