/**
 * INPUT: selected visible child, current Home client and durable conversation changes
 * OUTPUT: isolated real activity recovery using the shared ordered stream reducer
 * POS: ui/subagents — private adapter only; never subscribes to the primary Timeline channel
 */
// Owner-approved temporary size exception: one selection lifetime coordinates observation suspension and bounded body recovery.
/* eslint max-lines-per-function: ["error", { "max": 85, "skipBlankLines": true, "skipComments": true }] */
import { useEffect, useRef, useState } from "react";
import type { SubagentActivityReadResult, SubagentConversationEntry } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { createChatActivityRecovery, type ChatActivityRecovery } from "@/lib/chat-activity-recovery.js";
import { rememberPrivateActivity, type SubagentLiveView } from "./subagent-activity-retention.ts";
import { privateActivityHydrationPlan } from "./subagent-activity-hydration.ts";

interface ActivityInput { client: WsClient | null; characterId: string; childId: string | null; revision: unknown;
  tailSeq: number; entries: SubagentConversationEntry[]; hydrate(seqs: number[]): Promise<void> }
export interface ActivityRecovery { message: string | null; pending: boolean; retry(): void }

export function useSubagentActivity(input: ActivityInput): (SubagentLiveView & { recovery: ActivityRecovery }) | null {
  const [live, setLive] = useState<SubagentLiveView | null>(null);
  const recovery = useRef<ChatActivityRecovery | null>(null);
  const history = useRef(new Map<string, SubagentLiveView>());
  const [restoreVersion, setRestoreVersion] = useState(0);
  const [hydration, setHydration] = useState({ message: null as string | null, pending: false });
  const hydrationFlight = useRef<Promise<void> | null>(null);
  const hydrationAttempt = useRef("");
  const failedBodies = useRef(new Set<string>());
  const currentScope = useRef(input);
  currentScope.current = input;
  const entries = useRef(input.entries);
  entries.current = input.entries;
  const tailSeq = useRef(input.tailSeq);
  tailSeq.current = input.tailSeq;
  useEffect(() => {
    const { client, characterId, childId } = input;
    hydrationFlight.current = null;
    failedBodies.current.clear();
    setHydration({ message: null, pending: false });
    if (!client || !childId) { setLive((previous) => previous ? { ...previous, view: { ...previous.view, stale: true } } : null); return; }
    let current = true;
    let observing = true;
    let metadata: SubagentActivityReadResult | null = null;
    const positions = new Map<string, number>();
    const previous = history.current;
    hydrationAttempt.current = "";
    setLive((value) => value?.metadata?.subagentId === childId ? { ...value, view: { ...value.view, stale: true } } : null);
    const scope = { characterId, subagentId: childId };
    const adapter = createChatActivityRecovery({ characterId, context: { generation: 0, isCurrent: () => current },
      client: {
        onChatActivity: (handler) => client.onSubagentActivity((event) => { if (event.subagentId === childId) handler(event.activity); }),
        chatActivityRead: async () => { const result = await client.subagentActivityRead(scope); if (current) metadata = result; return result.activity; },
        subscribeTimeline: () => client.subscribeSubagentActivity(scope), onClose: (handler) => client.onClose(handler),
      },
      onChange: (view) => {
        if (!current || !observing) return;
        const next = rememberPrivateActivity(previous, { view, metadata, positions }, { entries: entries.current, tailSeq: tailSeq.current, subagentId: childId });
        setLive(next);
        if (next.capacity) {
          observing = false;
          queueMicrotask(() => { adapter.dispose(); void client.unsubscribeSubagentActivity().catch(() => undefined); });
        }
      },
    });
    recovery.current = adapter;
    void adapter.restore().catch(() => { if (current) setLive((previous) => previous
      ? { ...previous, view: { ...previous.view, stale: true } } : { view: { snapshot: { status: "idle", characterId }, stale: true }, metadata }); });
    return () => { adapter.dispose(); current = false; recovery.current = null;
      void client.unsubscribeSubagentActivity().catch(() => undefined); };
  }, [input.client, input.characterId, input.childId, restoreVersion]);
  useEffect(() => { if (!live?.capacity) void recovery.current?.refresh().catch(() => undefined); }, [input.revision]);
  useEffect(() => {
    if (!input.client || !live || hydrationFlight.current) return;
    const plan = privateActivityHydrationPlan(input.entries, live);
    if (!plan.key || hydrationAttempt.current === plan.key
      || plan.selected.some((entry) => failedBodies.current.has(`${entry.seq}:${entry.body?.digest}`))) return;
    hydrationAttempt.current = plan.key;
    const source = input;
    setHydration({ message: null, pending: true });
    const task = input.hydrate(plan.selected.map((entry) => entry.seq)).then(() => {
      if (currentScope.current.client === source.client && currentScope.current.childId === source.childId) {
        setHydration({ message: null, pending: false });
        if (live.capacity) setRestoreVersion((version) => version + 1);
      }
    }).catch(() => {
      if (currentScope.current.client === source.client && currentScope.current.childId === source.childId) {
        for (const entry of plan.selected) failedBodies.current.add(`${entry.seq}:${entry.body?.digest}`);
        setHydration({ message: "已结束回复的完整记录恢复失败，已观察内容仍保留。可重试，或逐条读取完整正文。", pending: false });
      }
    }).finally(() => { if (hydrationFlight.current === task) hydrationFlight.current = null; });
    hydrationFlight.current = task;
  }, [input.entries, live, restoreVersion, input.client]);
  const plan = privateActivityHydrationPlan(input.entries, live);
  const message = hydration.message ?? (live?.capacity ? "实时缓存已达容量，已观察内容仍保留；新活动暂不可用。请恢复完整记录后重试。"
    : plan.limited ? "已结束回复超出自动恢复预算，请读取对应的完整正文。" : null);
  return live ? { ...live, recovery: { message, pending: hydration.pending, retry: () => setRestoreVersion((version) => version + 1) } } : null;
}

