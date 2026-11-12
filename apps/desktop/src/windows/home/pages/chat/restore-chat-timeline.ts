/**
 * INPUT:  an authenticated Chat client generation and its guarded Timeline/activity channels
 * OUTPUT: subscribed ordered activity, complete-history restoration and atomic live-to-durable handoffs
 * POS:    ui/chat — required read restoration; never changes send/cancel authority or replays an execution
 */
import type { ChatActivityView } from "@/lib/chat-activity-state.js";
import { activityMessageId } from "@/lib/chat-activity-state.js";
import { createChatActivityRecovery, type ChatActivityRecovery } from "@/lib/chat-activity-recovery.js";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import type { ConnectionGenerationContext } from "@/lib/connection-generation-controller.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useChatTimelineStore, type TimelineRestoreBaseline } from "./chat-timeline-store.ts";
import { readChatHistory } from "./read-chat-history.ts";

export type ChatRestorationClient = Pick<WsClient,
  "onTimelineAppended" | "onTimelineRemoved" | "onTimelineCommitted" | "subscribeTimeline" | "timelineHistory"
  | "onChatActivity" | "chatActivityRead" | "onClose"
>;

interface RestorationState {
  client: ChatRestorationClient;
  context: ConnectionGenerationContext;
  activity: ChatActivityRecovery;
  removed: Set<number>;
  latest: ChatActivityView | undefined;
  ready: boolean;
  historyVersion: number;
}

export async function restoreChatTimeline(client: ChatRestorationClient, context: ConnectionGenerationContext): Promise<void> {
  const beforeRestore = baseline();
  useChatTimelineStore.getState().markActivityStale();
  const state: RestorationState = { client, context, removed: new Set(), latest: undefined, ready: false, historyVersion: 0,
    activity: createChatActivityRecovery({ client, context, characterId: ACTIVE_CHARACTER_ID,
      onChange: (view) => receiveActivity(state, view) }) };
  installTimelineHandlers(state);
  await state.activity.restore();
  if (!context.isCurrent()) return;
  await restoreHistory(state, beforeRestore);
  if (!context.isCurrent()) return;
  state.ready = true;
  if (state.latest) receiveActivity(state, state.latest);
}

function baseline(): TimelineRestoreBaseline {
  const state = useChatTimelineStore.getState();
  return { seqs: new Set(state.entries.map((entry) => entry.seq)), nextBefore: state.nextBefore, loaded: state.loaded };
}

function installTimelineHandlers(state: RestorationState): void {
  const { client, context } = state;
  client.onTimelineAppended((entry) => {
    if (context.isCurrent() && entry.characterId === ACTIVE_CHARACTER_ID) useChatTimelineStore.getState().appendLive(entry);
  });
  client.onTimelineRemoved((ref) => {
    if (!context.isCurrent() || ref.characterId !== ACTIVE_CHARACTER_ID) return;
    state.removed.add(ref.seq);
    useChatTimelineStore.getState().removeEntry(ref.seq);
  });
  const unsubscribe = client.onTimelineCommitted((batch) => {
    if (!context.isCurrent() || batch.characterId !== ACTIVE_CHARACTER_ID) return;
    state.activity.flush();
    useChatTimelineStore.getState().commitBatch(batch);
  });
  client.onClose(unsubscribe);
}

function receiveActivity(state: RestorationState, view: ChatActivityView): void {
  if (!state.context.isCurrent()) return;
  state.latest = view;
  if (!state.ready) return;
  useChatTimelineStore.getState().applyActivity(view);
  const snapshot = view.snapshot;
  const terminal = snapshot.status === "terminal" || (snapshot.status === "unavailable" && snapshot.terminal !== undefined);
  const messageId = activityMessageId(snapshot);
  if (terminal && messageId && !useChatTimelineStore.getState().live.covered.has(messageId)) {
    void restoreHistory(state).catch(() => {
      if (state.context.isCurrent()) useChatTimelineStore.getState().markActivityStale();
    });
  }
}

async function restoreHistory(state: RestorationState, restoreBaseline?: TimelineRestoreBaseline): Promise<void> {
  const version = ++state.historyVersion;
  const before = restoreBaseline ?? baseline();
  const messageAnchors = new Map<string, number>();
  for (const turn of useChatTimelineStore.getState().live.turns) {
    const messageId = activityMessageId(turn.view.snapshot);
    if (messageId) messageAnchors.set(messageId, turn.anchorSeq);
  }
  const messageIds = new Set(messageAnchors.keys());
  const latest = state.latest && activityMessageId(state.latest.snapshot);
  if (latest) messageIds.add(latest);
  const current = () => state.context.isCurrent() && version === state.historyVersion;
  const page = await readChatHistory({ client: state.client, characterId: ACTIVE_CHARACTER_ID, messageIds, messageAnchors,
    afterSeq: before.seqs.size > 0 ? Math.max(...before.seqs) : undefined, isCurrent: current });
  if (current()) useChatTimelineStore.getState().reconcileLatest({
    page, baseline: before, removedDuringRestore: state.removed, activity: state.latest,
  });
}
