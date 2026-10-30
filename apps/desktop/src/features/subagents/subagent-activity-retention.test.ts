import { describe, expect, it, vi } from "vitest";
import type { SubagentConversationEntry, SubagentConversationResult } from "@taki/shared";
import { rememberPrivateActivity, privateActivityBytes, PRIVATE_ACTIVITY_MAX_BYTES, PRIVATE_ACTIVITY_MAX_SNAPSHOTS,
  type SubagentLiveView } from "./subagent-activity-retention.ts";
import { privateActivityHydrationPlan, PRIVATE_ACTIVITY_HYDRATE_MAX_CHARS, PRIVATE_ACTIVITY_HYDRATE_MAX_ENTRIES } from "./subagent-activity-hydration.ts";
import { SubagentConversationPages } from "./subagent-conversation-pages.ts";
import type { SubagentClient } from "./subagent-state.ts";
import { conversation } from "../../../test/subagent-conversation-fixture.ts";
import { CHILD_A } from "../../../test/s7-subagent-data.ts";

function longRun(index: number, length = 21_600) {
  const text = `Run ${index}: ` + "x".repeat(length);
  const runId = `long-run-${index}`;
  const raw = conversation().entries.find((row) => row.kind === "message")!;
  if (raw.kind !== "message") throw new Error("fixture");
  const seqs = [index * 2 + 1, index * 2 + 2];
  const full: SubagentConversationEntry[] = seqs.map((seq, position) => ({ ...raw, seq,
    message: { ...raw.message, runId, seq, stepNumber: 0, content: position === 0 ? text : "Completed batch witness" },
    presentation: { messageId: runId, references: position === 0 ? [{ kind: "text", itemId: "text", order: 0, start: 0, end: text.length }] : [] },
    batch: { runId, attemptId: raw.message.attemptId, stepNumber: 0, entrySeqs: seqs } }));
  const preview = full.map((entry) => ({ ...entry, presentation: undefined,
    body: { digest: "a".repeat(64), totalChars: JSON.stringify(entry).length, nextOffset: 0 as const },
    ...(entry.kind === "message" ? { message: { ...entry.message, content: entry.message.content.slice(0, 1000) } } : {}) }));
  const snapshot = { status: "terminal" as const, characterId: "taki", messageId: runId, runId, attemptId: raw.message.attemptId,
    seq: 3, outcome: "completed" as const, items: [{ kind: "text" as const, itemId: "text", order: 0, text }] };
  const live: SubagentLiveView = { view: { snapshot, stale: false }, metadata: { subagentId: CHILD_A, workInputId: raw.workInputId,
    activity: snapshot, coveredThroughStep: 0, itemSteps: [{ itemId: "text", stepNumber: 0 }] } };
  return { text, full, preview, live, runId };
}

function readScope(entries: SubagentConversationEntry[]) {
  let current = true;
  const page: SubagentConversationResult = { ...conversation(), entries };
  const body = vi.fn<SubagentClient["subagentConversationBody"]>();
  const client = { subagentConversation: vi.fn(async () => page), subagentConversationBody: body } as unknown as SubagentClient;
  return { body, pages: new SubagentConversationPages(), scope: { client, characterId: "taki", current: () => current }, retire: () => { current = false; } };
}

describe("bounded cross-Run private activity", () => {
  it("six normal long Runs hydrate complete canonical batches and retire additional snapshots without manual expansion", async () => {
    const runs = Array.from({ length: 6 }, (_, index) => longRun(index));
    const f = readScope(runs.flatMap((run) => run.preview));
    f.body.mockImplementation(async (params) => {
      const entry = runs.flatMap((run) => run.full).find((row) => row.seq === params.seq)!;
      const serialized = JSON.stringify(entry); const offset = params.offset ?? 0; const end = Math.min(serialized.length, offset + 12_000);
      return { seq: entry.seq, digest: "a".repeat(64), body: serialized.slice(offset, end), offset, complete: end === serialized.length,
        nextOffset: end === serialized.length ? null : end };
    });
    let entries = (await f.pages.read(f.scope, CHILD_A)).entries;
    const retained = new Map<string, SubagentLiveView>();
    for (const run of runs) {
      let rendered = rememberPrivateActivity(retained, run.live, { entries, tailSeq: entries.at(-1)!.seq });
      const plan = privateActivityHydrationPlan(entries, rendered);
      expect(plan.selected.length).toBeLessThanOrEqual(PRIVATE_ACTIVITY_HYDRATE_MAX_ENTRIES);
      expect(plan.selected.reduce((sum, entry) => sum + entry.body!.totalChars, 0)).toBeLessThanOrEqual(PRIVATE_ACTIVITY_HYDRATE_MAX_CHARS);
      for (const [index, entry] of plan.selected.entries()) {
        entries = (await f.pages.expand(f.scope, entry, PRIVATE_ACTIVITY_HYDRATE_MAX_CHARS)).entries;
        rendered = rememberPrivateActivity(retained, run.live, { entries, tailSeq: entries.at(-1)!.seq });
        if (index === 0) expect(retained.has(run.runId)).toBe(true);
      }
      expect(retained.size).toBe(0); expect(rendered.retained).toHaveLength(0);
      const canonical = entries.find((entry) => entry.seq === run.full[0]!.seq);
      expect(canonical?.kind === "message" && canonical.message.content).toBe(run.text);
    }
    expect(f.body).toHaveBeenCalledTimes(18);
  });

  it("failed hydration cannot grow snapshots beyond the hard bound or evict already displayed text", async () => {
    const runs = Array.from({ length: 8 }, (_, index) => longRun(index));
    const retained = new Map<string, SubagentLiveView>();
    const entries = runs.flatMap((run) => run.preview);
    const f = readScope(entries); await f.pages.read(f.scope, CHILD_A);
    f.body.mockRejectedValue(new Error("offline"));
    let last: SubagentLiveView | null = null;
    for (const run of runs) {
      last = rememberPrivateActivity(retained, run.live, { entries, tailSeq: entries.at(-1)!.seq });
      expect(retained.size).toBeLessThanOrEqual(PRIVATE_ACTIVITY_MAX_SNAPSHOTS);
      expect([...retained.values()].reduce((sum, value) => sum + privateActivityBytes(value), 0)).toBeLessThanOrEqual(PRIVATE_ACTIVITY_MAX_BYTES);
    }
    expect(last?.capacity).toBe(true); expect(last?.view.snapshot.status).toBe("unavailable");
    expect([...retained.keys()]).toEqual(runs.slice(0, 4).map((run) => run.runId));
    await expect(f.pages.expand(f.scope, runs[0]!.preview[0]!)).rejects.toThrow("offline");
    const restored = rememberPrivateActivity(retained, { metadata: null, view: { snapshot: { status: "idle", characterId: "taki" }, stale: false } }, { entries, tailSeq: 100 });
    expect(restored.retained).toHaveLength(4);
    expect(restored.retained?.[0]?.view.snapshot).toMatchObject({ items: [{ text: runs[0]!.text }] });
  });

  it("byte overflow also refuses admission and automatic hydration stays bounded for oversized bodies", async () => {
    const retained = new Map<string, SubagentLiveView>();
    const runs = Array.from({ length: 4 }, (_, index) => longRun(index, 800_000));
    const entries = runs.flatMap((run) => run.preview);
    let last: SubagentLiveView | null = null;
    for (const run of runs) last = rememberPrivateActivity(retained, run.live, { entries, tailSeq: 100 });
    expect(last?.capacity).toBe(true); expect(retained.size).toBeLessThan(PRIVATE_ACTIVITY_MAX_SNAPSHOTS);
    const plan = privateActivityHydrationPlan(entries, last);
    expect(plan.selected.every((entry) => entry.body!.totalChars <= PRIVATE_ACTIVITY_HYDRATE_MAX_CHARS)).toBe(true);
    const f = readScope(entries); await f.pages.read(f.scope, CHILD_A);
    f.body.mockResolvedValue({ seq: entries[0]!.seq, digest: "a".repeat(64), body: "x".repeat(12_000), offset: 0, nextOffset: 12_000, complete: false });
    await expect(f.pages.expand(f.scope, entries[0]!, 100)).rejects.toThrow("budget");
    expect(f.body).toHaveBeenCalledOnce();
    f.retire(); await expect(f.pages.expand(f.scope, entries[0]!, 100)).rejects.toThrow("Retired");
    expect(f.body).toHaveBeenCalledOnce();
  });
});
