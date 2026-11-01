import { describe, expect, it, vi } from "vitest";
import type { SubagentAttentionResult, SubagentChanged } from "@taki/shared";
import { EMPTY_ATTENTION_VIEW, SubagentAttentionController } from "./subagent-attention-controller.ts";
import type { WsClient } from "@/lib/ws-client.js";
import { CHILD_A, WORK_A } from "../../../test/s7-subagent-data.ts";

const flush = async () => { for (let count = 0; count < 20; count += 1) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const page: SubagentAttentionResult = { entries: [{ attentionId: "attention-a", kind: "needs_user_input",
    subagentId: CHILD_A, workInputId: WORK_A, label: "private worker", eventId: "event-a", consumerId: "consumer-a",
    reason: "private body must stay out of toast", canResume: false }], nextCursor: null };
  let changed: ((change: SubagentChanged) => void) | null = null;
  const client: Pick<WsClient, "subagentAttention" | "subagentInboxResume" | "subagentInboxRetry" | "subscribeSubagents" | "onSubagentChanged"> = {
    subagentAttention: vi.fn(async () => page), subscribeSubagents: vi.fn(async () => "supported" as const),
    onSubagentChanged: vi.fn((handler) => { changed = handler; return () => { changed = null; }; }),
    subagentInboxResume: vi.fn(async () => ({ consumerId: "successor", runId: "run-successor", reused: false, state: "claimed" as const })),
    subagentInboxRetry: vi.fn(async () => ({ status: "scheduled" as const })),
  };
  let state = EMPTY_ATTENTION_VIEW;
  const notice = vi.fn();
  const controller = new SubagentAttentionController((next) => { state = next; }, notice);
  return { page, client, notice, controller, state: () => state,
    emit: (revision = 1) => changed?.({ characterId: "taki", subagentId: CHILD_A, revision }) };
}

describe("Home-wide child attention", () => {
  it("offers exhausted pre-intent retry only on explicit click and never replays it on reconnect", async () => {
    const f = setup(); f.page.entries[0]!.kind = "inbox_retry_exhausted";
    f.page.entries[0]!.canResume = true; f.page.entries[0]!.consumerId = null;
    f.controller.bind(f.client, "taki"); await flush();
    expect(f.client.subagentInboxRetry).not.toHaveBeenCalled();
    vi.mocked(f.client.subagentInboxRetry).mockRejectedValueOnce(new Error("lost"));
    await f.controller.resume("attention-a"); await flush(); expect(f.state().feedback).toContain("尚未确认");
    f.controller.bind(null, "taki"); f.controller.bind(f.client, "taki"); await flush();
    expect(f.client.subagentInboxRetry).toHaveBeenCalledOnce(); expect(f.client.subagentInboxResume).not.toHaveBeenCalled();
    await f.controller.resume("attention-a"); expect(f.client.subagentInboxRetry).toHaveBeenCalledTimes(2);
    expect(f.client.subagentInboxRetry).toHaveBeenLastCalledWith({ characterId: "taki" });
    expect(f.state().feedback).toContain("已请求重新尝试");
  });
  it("serializes recovery and lets a hidden command settle without replaying it on reveal", async () => {
    const f = setup(); f.page.entries[0]!.kind = "reconciliation_needed"; f.page.entries[0]!.canResume = true;
    f.controller.bind(f.client, "taki"); await flush();
    const pending = deferred<Awaited<ReturnType<typeof f.client.subagentInboxResume>>>();
    vi.mocked(f.client.subagentInboxResume).mockReturnValueOnce(pending.promise);
    const action = f.controller.resume("attention-a"); await f.controller.resume("attention-a");
    expect(f.client.subagentInboxResume).toHaveBeenCalledOnce(); f.controller.setVisible(false);
    pending.resolve({ consumerId: "successor", runId: "run-successor", reused: false, state: "claimed" }); await action;
    const reads = vi.mocked(f.client.subagentAttention).mock.calls.length;
    f.controller.setVisible(true); await flush();
    expect(f.state().pending).toBeNull(); expect(f.client.subagentInboxResume).toHaveBeenCalledOnce();
    expect(vi.mocked(f.client.subagentAttention).mock.calls.length).toBe(reads + 1);
  });
  it("resumes only an exact allowed reconciliation entry and reuses unknown-outcome operation after reconnect", async () => {
    const f = setup(); f.page.entries[0]!.kind = "reconciliation_needed"; f.page.entries[0]!.canResume = true;
    f.controller.bind(f.client, "taki"); await flush();
    expect(f.client.subagentInboxResume).not.toHaveBeenCalled();
    await f.controller.resume("wrong"); expect(f.client.subagentInboxResume).not.toHaveBeenCalled();
    vi.mocked(f.client.subagentInboxResume).mockRejectedValueOnce(new Error("lost"));
    await f.controller.resume("attention-a"); await flush();
    expect(f.state().feedback).toContain("尚未确认");
    const submitted = vi.mocked(f.client.subagentInboxResume).mock.calls[0]![0];
    expect(submitted.consumerId).toBe("consumer-a");
    f.controller.bind(null, "taki"); f.controller.bind(f.client, "taki"); await flush();
    expect(f.client.subagentInboxResume).toHaveBeenCalledOnce();
    await f.controller.resume("attention-a"); expect(vi.mocked(f.client.subagentInboxResume).mock.calls[1]![0]).toEqual(submitted);
  });
  it("reads only after acknowledged observation and reaches Home without selecting Subagents", async () => {
    const f = setup(); const ack = deferred<"supported">();
    vi.mocked(f.client.subscribeSubagents).mockReturnValue(ack.promise);
    f.controller.bind(f.client, "taki"); f.emit(); await flush();
    expect(f.client.subagentAttention).not.toHaveBeenCalled();
    ack.resolve("supported"); await flush();
    expect(f.state().page?.entries[0]?.kind).toBe("needs_user_input");
    expect(f.notice).toHaveBeenCalledOnce();
    expect(f.notice.mock.calls[0]?.[0]).not.toContain("private body");
    expect(f.client.subagentAttention).toHaveBeenCalledWith({ characterId: "taki", afterId: undefined, limit: 20 });
  });

  it("deduplicates attention through repeated hints, refresh and replacement connections", async () => {
    const f = setup(); f.controller.bind(f.client, "taki"); await flush();
    f.emit(1); f.emit(1); await flush(); await f.controller.refresh();
    f.controller.bind(null, "taki"); f.controller.bind(f.client, "taki"); await flush();
    expect(f.notice).toHaveBeenCalledOnce();
    f.page.entries[0]!.attentionId = "attention-new";
    f.page.entries[0]!.kind = "reconciliation_needed";
    f.emit(2); await flush(); expect(f.notice).toHaveBeenCalledTimes(2);
    expect(f.notice.mock.calls[1]?.[0]).toContain("需要核对");
  });

  it("coalesces change bursts, preserves stale contents on failure and never polls", async () => {
    const f = setup(); f.controller.bind(f.client, "taki"); await flush();
    const pending = deferred<SubagentAttentionResult>();
    vi.mocked(f.client.subagentAttention).mockReturnValueOnce(pending.promise);
    f.emit(); await flush();
    for (let count = 0; count < 30; count += 1) f.emit(count);
    expect(f.client.subagentAttention).toHaveBeenCalledTimes(2);
    pending.resolve(f.page); await flush(); expect(f.client.subagentAttention).toHaveBeenCalledTimes(3);
    vi.mocked(f.client.subagentAttention).mockRejectedValueOnce(new Error("offline"));
    f.emit(100); await flush(); expect(f.state().page).toBe(f.page);
    expect(f.state().fresh).toBe(false); expect(f.state().error).toContain("读取失败");
    await flush(); expect(f.client.subagentAttention).toHaveBeenCalledTimes(4);
  });

  it("ignores retired reads, retains hidden gaps and reconciles document reveal", async () => {
    const f = setup(); f.controller.bind(f.client, "taki"); await flush();
    const pending = deferred<SubagentAttentionResult>();
    vi.mocked(f.client.subagentAttention).mockReturnValueOnce(pending.promise);
    f.emit(); await flush(); f.controller.bind(null, "taki");
    pending.resolve({ entries: [], nextCursor: null }); await flush();
    expect(f.state().page?.entries).toHaveLength(1); expect(f.state().fresh).toBe(false);
    f.controller.setVisible(false); f.controller.bind(f.client, "taki"); f.emit(); await flush();
    expect(f.client.subagentAttention).toHaveBeenCalledTimes(2);
    f.controller.setVisible(true); await flush(); expect(f.state().fresh).toBe(true);
    expect(f.client.subagentAttention).toHaveBeenCalledTimes(3); expect(f.notice).toHaveBeenCalledOnce();
  });

  it("pages bounded attention and resets to newest when an actual change arrives", async () => {
    const f = setup(); f.page.nextCursor = "next-a";
    f.controller.bind(f.client, "taki"); await flush();
    f.controller.older(); await flush(); expect(f.state().older).toBe(true);
    expect(f.client.subagentAttention).toHaveBeenLastCalledWith({ characterId: "taki", afterId: "next-a", limit: 20 });
    f.emit(); await flush(); expect(f.state().older).toBe(false);
    expect(f.client.subagentAttention).toHaveBeenLastCalledWith({ characterId: "taki", afterId: undefined, limit: 20 });
  });
});
