/**
 * INPUT:  one authenticated candidate chat WsClient and its lifecycle generation guard.
 * OUTPUT: restoreChatTimeline() — guarded local handlers, one subscription, then authoritative history merge.
 * POS:    ui/windows/home/pages/chat — required per-generation restoration before Chat publishes connected.
 */

import { TIMELINE_HISTORY_LIMIT_DEFAULT } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import type { ConnectionGenerationContext } from "@/lib/connection-generation-controller.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useChatTimelineStore } from "./chat-timeline-store.ts";

export type ChatRestorationClient = Pick<
  WsClient,
  "onTimelineAppended" | "onTimelineRemoved" | "subscribeTimeline" | "timelineHistory"
>;

export async function restoreChatTimeline(
  client: ChatRestorationClient,
  context: ConnectionGenerationContext,
): Promise<void> {
  const beforeRestore = useChatTimelineStore.getState();
  const baseline = {
    seqs: new Set(beforeRestore.entries.map((entry) => entry.seq)),
    nextBefore: beforeRestore.nextBefore,
    loaded: beforeRestore.loaded,
  };
  const removedDuringRestore = new Set<number>();
  client.onTimelineAppended((entry) => {
    if (context.isCurrent()) useChatTimelineStore.getState().appendLive(entry);
  });
  client.onTimelineRemoved((ref) => {
    if (!context.isCurrent()) return;
    removedDuringRestore.add(ref.seq);
    useChatTimelineStore.getState().removeEntry(ref.seq);
  });
  await client.subscribeTimeline(ACTIVE_CHARACTER_ID);
  if (!context.isCurrent()) return;
  const page = await client.timelineHistory({
    characterId: ACTIVE_CHARACTER_ID,
    limit: TIMELINE_HISTORY_LIMIT_DEFAULT,
  });
  if (context.isCurrent()) {
    useChatTimelineStore.getState().reconcileLatest({ page, baseline, removedDuringRestore });
  }
}
