/**
 * INPUT: selected visible child, current Home client and durable conversation changes
 * OUTPUT: isolated real activity recovery using the shared ordered stream reducer
 * POS: ui/subagents — private adapter only; never subscribes to the primary Timeline channel
 */
import { useEffect, useRef, useState } from "react";
import type { SubagentActivityReadResult, SubagentConversationEntry } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createChatActivityRecovery, type ChatActivityRecovery } from "@/lib/chat-activity-recovery.js";
import type { ChatActivityView } from "@/lib/chat-activity-state.js";
import { activityItemKey } from "@/lib/chat-activity-state.js";
import { completePrivateItem } from "./subagent-live-coverage.ts";

export interface SubagentLiveView { view: ChatActivityView; metadata: SubagentActivityReadResult | null; positions?: Map<string, number>; retained?: SubagentLiveView[] }
interface ActivityInput { client: WsClient | null; characterId: string; childId: string | null; revision: unknown; tailSeq: number; entries: SubagentConversationEntry[] }

export function useSubagentActivity(input: ActivityInput): SubagentLiveView | null {
  const [live, setLive] = useState<SubagentLiveView | null>(null);
  const recovery = useRef<ChatActivityRecovery | null>(null);
  const history = useRef(new Map<string, Map<string, SubagentLiveView>>());
  const entries = useRef(input.entries);
  entries.current = input.entries;
  const tailSeq = useRef(input.tailSeq);
  tailSeq.current = input.tailSeq;
  useEffect(() => {
    const { client, characterId, childId } = input;
    if (!client || !childId) { setLive((previous) => previous ? { ...previous, view: { ...previous.view, stale: true } } : null); return; }
    let current = true;
    let metadata: SubagentActivityReadResult | null = null;
    const positions = new Map<string, number>();
    const cacheKey = JSON.stringify([characterId, childId]);
    const previous = history.current.get(cacheKey) ?? new Map<string, SubagentLiveView>();
    history.current.set(cacheKey, previous);
    setLive((value) => value?.metadata?.subagentId === childId ? { ...value, view: { ...value.view, stale: true } } : null);
    const scope = { characterId, subagentId: childId };
    const adapter = createChatActivityRecovery({ characterId, context: { generation: 0, isCurrent: () => current },
      client: {
        onChatActivity: (handler) => client.onSubagentActivity((event) => { if (event.subagentId === childId) handler(event.activity); }),
        chatActivityRead: async () => { const result = await client.subagentActivityRead(scope); if (current) metadata = result; return result.activity; },
        subscribeTimeline: () => client.subscribeSubagentActivity(scope), onClose: (handler) => client.onClose(handler),
      },
      onChange: (view) => {
        if (!current) return;
        setLive(rememberPrivateActivity(previous, { view, metadata, positions }, { entries: entries.current, tailSeq: tailSeq.current }));
      },
    });
    recovery.current = adapter;
    void adapter.restore().catch(() => { if (current) setLive((previous) => previous
      ? { ...previous, view: { ...previous.view, stale: true } } : { view: { snapshot: { status: "idle", characterId }, stale: true }, metadata }); });
    return () => { adapter.dispose(); current = false; recovery.current = null;
      void client.unsubscribeSubagentActivity().catch(() => undefined); };
  }, [input.client, input.characterId, input.childId]);
  useEffect(() => { void recovery.current?.refresh().catch(() => undefined); }, [input.revision]);
  return live;
}

export function rememberPrivateActivity(previous: Map<string, SubagentLiveView>, current: SubagentLiveView,
  context: { entries: SubagentConversationEntry[]; tailSeq: number }): SubagentLiveView {
  const { snapshot } = current.view;
  const positions = current.positions ?? new Map<string, number>();
  if ("items" in snapshot) for (const item of snapshot.items) {
    const key = activityItemKey(snapshot.messageId, item.itemId);
    if (!positions.has(key)) positions.set(key, previous.get(snapshot.messageId)?.positions?.get(key) ?? context.tailSeq + 0.5);
  }
  for (const [key, retained] of previous) {
    const old = retained.view.snapshot;
    if ("items" in old && old.items.every((item) => completePrivateItem(context.entries, { messageId: old.messageId, itemId: item.itemId }))) previous.delete(key);
  }
  const currentView = { ...current, positions };
  if (snapshot.status !== "idle") previous.set(snapshot.messageId, currentView);
  const messageId = snapshot.status === "idle" ? null : snapshot.messageId;
  return { ...currentView, retained: [...previous].filter(([key]) => key !== messageId)
    .map(([, retained]) => ({ ...retained, view: { ...retained.view, stale: true } })) };
}
