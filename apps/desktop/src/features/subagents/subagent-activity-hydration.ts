/**
 * INPUT: terminal/obsolete observed Runs and the existing scoped canonical reading cache
 * OUTPUT: bounded full-body hydration requests needed for proved live-to-durable replacement
 * POS: ui/subagents — read-only recovery planning, never polling or mutation replay
 */
import type { SubagentConversationEntry } from "@taki/shared";
import type { SubagentLiveView } from "./subagent-activity-retention.ts";

export const PRIVATE_ACTIVITY_HYDRATE_MAX_ENTRIES = 4;
export const PRIVATE_ACTIVITY_HYDRATE_MAX_CHARS = 256_000;

export function privateActivityHydrationPlan(entries: SubagentConversationEntry[], live: SubagentLiveView | null) {
  const views = [...live?.retained ?? [], ...(live && live.view.snapshot.status === "terminal" ? [live] : [])];
  const runs = new Set(views.flatMap((value) => value.view.snapshot.status === "idle" ? [] : [value.view.snapshot.runId]));
  const candidates = entries.filter((entry) => entry.body && (entry.batch && runs.has(entry.batch.runId)
    || entry.kind === "message" && runs.has(entry.message.runId) || entry.kind === "event" && runs.has(entry.event.producerRunId)));
  const selected: SubagentConversationEntry[] = [];
  let chars = 0;
  for (const entry of candidates) {
    const size = entry.body?.totalChars ?? 0;
    if (selected.length >= PRIVATE_ACTIVITY_HYDRATE_MAX_ENTRIES) break;
    if (chars + size > PRIVATE_ACTIVITY_HYDRATE_MAX_CHARS) continue;
    chars += size; selected.push(entry);
  }
  return { selected, limited: candidates.length > 0 && selected.length === 0,
    key: selected.map((entry) => `${entry.seq}:${entry.body?.digest}`).join("|") };
}
