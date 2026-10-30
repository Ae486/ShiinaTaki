import { describe, expect, it, vi } from "vitest";
import { JSONRPCErrorException } from "json-rpc-2.0";
import type { SubagentChanged, SubagentControlResult } from "@taki/shared";
import { SubagentController } from "./subagent-controller.ts";
import { INITIAL_SUBAGENT_STATE, displayedTarget, type SubagentClient, type SubagentState } from "./subagent-state.ts";
import { CHILD_A, CHILD_B, WORK_A, WORK_B, history, summary, work } from "../../../test/s7-subagent-data.ts";
import { conversation } from "../../../test/subagent-conversation-fixture.ts";

const flush = async () => { for (let i = 0; i < 15; i += 1) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  let state: SubagentState = INITIAL_SUBAGENT_STATE;
  let changed: ((event: SubagentChanged) => void) | null = null;
  const data = history();
  const response: SubagentControlResult = { conversation: data.conversation, input: null, cancellationRequested: false };
  const client: SubagentClient = {
    subagentList: vi.fn(async () => ({ entries: [summary(), summary(CHILD_B)], nextCursor: null })),
    subagentHistory: vi.fn(async (params) => history(params.subagentId)),
    subagentConversation: vi.fn(async (params) => conversation(params.subagentId)),
    subagentConversationBody: vi.fn(async () => { throw new Error("not used"); }),
    subagentResult: vi.fn(async () => { throw new Error("not used"); }),
    subagentSend: vi.fn(async () => response), subagentStop: vi.fn(async () => response), subagentContinue: vi.fn(async () => response),
    subscribeSubagents: vi.fn(async () => "supported" as const),
    onSubagentChanged: vi.fn((handler) => { changed = handler; return () => { changed = null; }; }),
  };
  const controller = new SubagentController((next) => { state = next; });
  return { controller, client, state: () => state, target: () => displayedTarget(state)!,
    emit: (subagentId = CHILD_A) => changed?.({ characterId: "taki", subagentId, revision: 1 }) };
}
async function ready(h: ReturnType<typeof setup>) {
  h.controller.bind(h.client); await flush(); h.controller.select(CHILD_A); await flush();
}

describe("private child controller", () => {
  it("unrelated child progress refreshes the list without disabling the selected child's Send", async () => {
    const h = setup(); await ready(h);
    const list = deferred<Awaited<ReturnType<SubagentClient["subagentList"]>>>();
    vi.mocked(h.client.subagentList).mockReturnValueOnce(list.promise);
    const reads = vi.mocked(h.client.subagentConversation).mock.calls.length;
    h.emit(CHILD_B);
    expect(h.state().fresh).toBe(true);
    expect(vi.mocked(h.client.subagentConversation).mock.calls.length).toBe(reads);
    expect(await h.controller.act(h.target(), "send", "A remains addressable")).toBe(true);
    expect(h.client.subagentSend).toHaveBeenCalledOnce();
    list.resolve({ entries: [summary()], nextCursor: null }); await flush();
  });
  it("retains drafts per child/work and rejects silent retargeting after control changes", async () => {
    const h = setup(); await ready(h); const target = h.target();
    h.controller.editDraft(target, "A draft");
    h.controller.select(CHILD_B); await flush(); h.controller.editDraft(h.target(), "B draft");
    h.controller.select(CHILD_A); await flush();
    expect(h.controller.draft(h.target()).text).toBe("A draft");
    const changed = conversation(); changed.conversation.controlVersion += 1;
    vi.mocked(h.client.subagentConversation).mockResolvedValue(changed); h.emit(); await flush();
    expect(h.controller.draftReady(h.target())).toBe(false);
    expect(await h.controller.submitDraft(h.target(), "send")).toBe(false);
    expect(h.client.subagentSend).not.toHaveBeenCalled();
    h.controller.confirmDraft(h.target()); expect(h.controller.draftReady(h.target())).toBe(true);
  });

  it("accepted submission clears only the submitted draft revision", async () => {
    const h = setup(); await ready(h); const target = h.target();
    h.controller.editDraft(target, "submitted"); const pending = deferred<SubagentControlResult>();
    vi.mocked(h.client.subagentSend).mockReturnValueOnce(pending.promise);
    const action = h.controller.submitDraft(target, "send"); h.controller.editDraft(target, "newer edit");
    pending.resolve({ conversation: summary(), input: work(), cancellationRequested: false }); await action;
    expect(h.controller.draft(target).text).toBe("newer edit");
  });

  it("Send and continue performs exactly one continuation and addresses the current input wait", async () => {
    const h = setup(); const data = conversation();
    data.conversation.stopOrigin = "user"; data.conversation.activeRunId = null; data.conversation.state = "blocked_user";
    data.conversation.pendingRequest = { eventId: "question-a", workInputId: WORK_A, state: "open", answerInputId: null };
    vi.mocked(h.client.subagentConversation).mockResolvedValue(data); await ready(h);
    h.controller.editDraft(h.target(), "addressed answer");
    expect(await h.controller.submitDraft(h.target(), "continue")).toBe(true);
    expect(h.client.subagentContinue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ direction: "addressed answer", replyToEventId: "question-a" }));
    expect(h.client.subagentSend).not.toHaveBeenCalled();
  });

  it("unknown outcome keeps the draft and cannot be resubmitted automatically after a fresh read", async () => {
    const h = setup(); await ready(h); const target = h.target(); h.controller.editDraft(target, "once");
    vi.mocked(h.client.subagentSend).mockRejectedValueOnce(new Error("connection lost"));
    expect(await h.controller.submitDraft(target, "send")).toBe(false); await flush();
    expect(h.controller.draft(target)).toMatchObject({ text: "once", uncertain: true });
    expect(await h.controller.submitDraft(h.target(), "send")).toBe(false);
    expect(h.client.subagentSend).toHaveBeenCalledOnce();
  });
  it("installs the handler and waits for subscription acknowledgement before reading", async () => {
    const h = setup(); const subscribed = deferred<"supported">();
    vi.mocked(h.client.subscribeSubagents).mockReturnValue(subscribed.promise);
    h.controller.bind(h.client); h.controller.select(CHILD_A); h.emit(); await flush();
    expect(h.client.onSubagentChanged).toHaveBeenCalledOnce();
    expect(h.client.subagentConversation).not.toHaveBeenCalled(); expect(h.client.subagentList).not.toHaveBeenCalled();
    subscribed.resolve("supported"); await flush();
    expect(h.state().detail?.conversation.subagentId).toBe(CHILD_A); expect(h.state().fresh).toBe(true);
  });
  it("retains committed child A while B loads and refuses callbacks for A once B commits", async () => {
    const h = setup(); await ready(h); const old = h.target(); const pending = deferred<ReturnType<typeof conversation>>();
    vi.mocked(h.client.subagentConversation).mockReturnValueOnce(pending.promise);
    h.controller.select(CHILD_B); expect(h.state().selectedId).toBe(CHILD_A); expect(h.state().fresh).toBe(false);
    expect(await h.controller.act(old, "stop")).toBe(false);
    pending.resolve(conversation(CHILD_B)); await flush();
    expect(h.state().selectedId).toBe(CHILD_B); expect(await h.controller.act(old, "stop")).toBe(false);
    expect(h.client.subagentStop).not.toHaveBeenCalled();
  });
  it("sends the exact work and nullable Run/version; stop never calls parent cancellation", async () => {
    const h = setup(); const data = conversation(); data.conversation.activeRunId = null; data.conversation.activeWorkInputId = null;
    vi.mocked(h.client.subagentConversation).mockResolvedValue(data); await ready(h);
    await h.controller.act(h.target(), "stop");
    expect(h.client.subagentStop).toHaveBeenCalledWith({ characterId: "taki", target: { subagentId: CHILD_A, workInputId: WORK_A, expectedRunId: null, expectedControlVersion: 2 } });
  });
  it("retains unknown submitted outcome across null and replacement clients without replay or late success", async () => {
    const h = setup(); await ready(h); const pending = deferred<SubagentControlResult>();
    vi.mocked(h.client.subagentSend).mockReturnValue(pending.promise);
    const action = h.controller.act(h.target(), "send", "preserved draft");
    h.controller.bind(null); expect(h.state().feedback?.message).toContain("尚未确认");
    const replacement = setup(); h.controller.bind(replacement.client); await flush();
    pending.resolve({ conversation: summary(), input: work(), cancellationRequested: false }); await action;
    expect(h.state().feedback?.message).toContain("尚未确认"); expect(replacement.client.subagentSend).not.toHaveBeenCalled();
    expect(h.client.subagentSend).toHaveBeenCalledOnce();
  });
  it("keeps a stale-target conflict separate from a failed reconciliation and never resubmits", async () => {
    const h = setup(); await ready(h);
    vi.mocked(h.client.subagentSend).mockRejectedValue(new JSONRPCErrorException("stale", -32000, { reason: "SUBAGENT_CONTROL_CONFLICT" }));
    vi.mocked(h.client.subagentConversation).mockRejectedValue(new Error("offline read"));
    expect(await h.controller.act(h.target(), "send", "correction")).toBe(false); await flush();
    expect(h.state().feedback?.message).toContain("控制状态已变化"); expect(h.state().detailError).toContain("读取私有会话失败");
    expect(h.state().detail).not.toBeNull(); expect(h.state().fresh).toBe(false); expect(h.client.subagentSend).toHaveBeenCalledOnce();
  });
  it("a hidden pending mutation still settles, while reads resume only on re-entry", async () => {
    const h = setup(); await ready(h); const pending = deferred<SubagentControlResult>();
    vi.mocked(h.client.subagentContinue).mockReturnValue(pending.promise);
    const action = h.controller.act(h.target(), "continue"); h.controller.setVisible(false);
    pending.resolve({ conversation: summary(), input: work({ kind: "continue" }), cancellationRequested: false }); await action;
    const calls = vi.mocked(h.client.subagentConversation).mock.calls.length;
    h.controller.setVisible(true); await flush();
    expect(vi.mocked(h.client.subagentConversation).mock.calls.length).toBe(calls + 1); expect(h.state().pending).toBeNull();
  });
  it("explicit work selection keeps a different active work out of the addressed payload", async () => {
    const h = setup(); const data = conversation(); data.entries.push({ kind: "input", seq: 20, subagentId: CHILD_A, workInputId: WORK_B, historicalOrder: false, createdAt: data.conversation.createdAt, input: work({ inputId: WORK_B, workInputId: WORK_B, inputSeq: 3 }) });
    vi.mocked(h.client.subagentConversation).mockResolvedValue(data); await ready(h); h.controller.selectWork(WORK_B);
    await h.controller.act(h.target(), "send", "for B");
    expect(h.client.subagentSend).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ workInputId: WORK_B }) }));
    expect(h.client.subagentContinue).not.toHaveBeenCalled();
  });
  it("subscription failure remains an error and retries only on demand", async () => {
    const h = setup(); vi.mocked(h.client.subscribeSubagents).mockRejectedValueOnce(new Error("failed"));
    h.controller.bind(h.client); await flush(); expect(h.state().readError).toContain("订阅"); expect(h.state().list).toBeNull();
    await h.controller.refresh(); expect(h.state().list?.entries).toHaveLength(2);
  });
});
