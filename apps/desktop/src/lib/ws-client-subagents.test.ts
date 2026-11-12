import { describe, expect, it, vi } from "vitest";
import { createWsClient } from "./ws-client.ts";
import type { WsTransport } from "./ws-transport.ts";
import { CHILD_A, WORK_A, history, summary } from "../../test/s7-subagent-data.ts";
import { conversation } from "../../test/subagent-conversation-fixture.ts";

function harness() {
  const sent: string[] = [];
  let deliver: (frame: string) => void = () => undefined;
  const close: Array<() => void> = [];
  const transport: WsTransport = { send: (frame) => sent.push(frame), close: () => undefined,
    onMessage: (handler) => { deliver = handler; }, onOpen: () => undefined, onClose: (handler) => close.push(handler) };
  const client = createWsClient({ transport });
  return { client, sent, close: () => close.forEach((handler) => handler()),
    activity: (params: unknown) => deliver(JSON.stringify({ jsonrpc: "2.0", method: "subagent.activity", params })),
    notify: (params: unknown) => deliver(JSON.stringify({ jsonrpc: "2.0", method: "subagent.changed", params })),
    respond: (result: unknown) => deliver(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(sent.at(-1)!).id, result })) };
}
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

describe("Shared child wire boundary", () => {
  it("parses conversation/body pages and selected activity independently from main Chat", async () => {
    const h = harness(); const child = vi.fn(); const main = vi.fn();
    h.client.onSubagentActivity(child); h.client.onChatActivity(main);
    const subscribe = h.client.subscribeSubagentActivity({ characterId: "taki", subagentId: CHILD_A });
    h.respond({ status: "ok" }); await subscribe;
    const event = { subagentId: CHILD_A, workInputId: WORK_A, activity: { characterId: "taki", messageId: "child-run", seq: 1, kind: "turn.started" } };
    h.activity(event); await flush(); expect(child).toHaveBeenCalledWith(event); expect(main).not.toHaveBeenCalled();
    const read = h.client.subagentConversation({ characterId: "taki", subagentId: CHILD_A });
    h.respond(conversation()); expect((await read).entries).toHaveLength(10);
    const body = h.client.subagentConversationBody({ characterId: "taki", subagentId: CHILD_A, seq: 1, offset: 0 });
    h.respond({ seq: 1, digest: "a".repeat(64), offset: 0, body: "{}", nextOffset: null, complete: true });
    expect((await body).complete).toBe(true);
    const unsubscribe = h.client.unsubscribeSubagentActivity(); h.respond({ status: "ok" }); await unsubscribe;
    expect(JSON.parse(h.sent.at(-1)!).method).toBe("subagent.activity.unsubscribe");
    h.close(); h.activity(event); await flush(); expect(child).toHaveBeenCalledOnce();
  });
  it("parses each public query/control shape and forwards exact targeting", async () => {
    const h = harness();
    const list = h.client.subagentList({ characterId: "taki" }); h.respond({ entries: [summary()], nextCursor: null }); expect((await list).entries).toHaveLength(1);
    const detail = h.client.subagentHistory({ characterId: "taki", subagentId: CHILD_A }); h.respond(history()); expect((await detail).inputs).toHaveLength(2);
    const send = h.client.subagentSend({ characterId: "taki", operationKey: "one", direction: "exact work", materials: [],
      target: { subagentId: CHILD_A, workInputId: WORK_A, expectedRunId: null, expectedControlVersion: 2 } });
    expect(JSON.parse(h.sent.at(-1)!).params.target.expectedRunId).toBeNull();
    h.respond({ conversation: summary(), input: null, cancellationRequested: false }); await send;
    const bad = h.client.subagentList({ characterId: "taki" }); h.respond({ entries: [], nextCursor: null, fake: true }); await expect(bad).rejects.toThrow();
  });
  it("deduplicates successful setup and retries a malformed acknowledgement only on demand", async () => {
    const h = harness(); const first = h.client.subscribeSubagents(); const joined = h.client.subscribeSubagents(); expect(h.sent).toHaveLength(1);
    h.respond({ status: "wrong" }); await expect(first).rejects.toThrow(); await expect(joined).rejects.toThrow();
    const retry = h.client.subscribeSubagents(); expect(h.sent).toHaveLength(2); h.respond({ status: "ok" }); expect(await retry).toBe("supported");
    expect(await h.client.subscribeSubagents()).toBe("supported"); expect(h.sent).toHaveLength(2);
  });
  it("validates changed notifications, isolates handlers, and retires them with the socket", async () => {
    const h = harness(); const receive = vi.fn(); h.client.onSubagentChanged(() => { throw new Error("observer"); }); h.client.onSubagentChanged(receive);
    h.notify({ characterId: "taki", subagentId: CHILD_A, revision: 1 }); await flush(); expect(receive).toHaveBeenCalledOnce();
    h.notify({ characterId: "taki", subagentId: "invalid", revision: 2 }); await flush(); expect(receive).toHaveBeenCalledOnce();
    h.close(); h.notify({ characterId: "taki", subagentId: CHILD_A, revision: 3 }); await flush(); expect(receive).toHaveBeenCalledOnce();
  });
});
