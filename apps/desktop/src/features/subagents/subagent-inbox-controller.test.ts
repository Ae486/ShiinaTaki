import { describe, expect, it, vi } from "vitest";
import { SubagentInboxController, EMPTY_INBOX_VIEW } from "./subagent-inbox-controller.ts";
import type { WsClient } from "@/lib/ws-client.js";
const flush = async () => { for (let count = 0; count < 15; count += 1) await Promise.resolve(); };

function fixture() {
  const read = { entries: [{ consumerId: "consumer-a", runId: "run-a", reason: "missing_disposition", canResume: true, events: [], actions: [] }], nextCursor: null };
  const client: Pick<WsClient, "subagentInboxRecovery" | "subagentInboxResume" | "onSubagentChanged" | "subscribeSubagents"> = {
    subagentInboxRecovery: vi.fn(async () => read),
    subagentInboxResume: vi.fn(async () => ({ consumerId: "consumer-b", runId: "run-b", reused: false, state: "claimed" as const })),
    onSubagentChanged: vi.fn(() => () => undefined), subscribeSubagents: vi.fn(async () => "supported" as const),
  };
  let state = EMPTY_INBOX_VIEW;
  const controller = new SubagentInboxController((next) => { state = next; });
  return { read, client, controller, state: () => state };
}

describe("explicit parent inbox recovery", () => {
  it("never starts continuation while reading, and only current allowed rows can be resumed", async () => {
    const f = fixture(); f.controller.bind(f.client, "taki"); await flush();
    expect(f.state().fresh).toBe(true); expect(f.client.subagentInboxResume).not.toHaveBeenCalled();
    await f.controller.resume("missing"); expect(f.client.subagentInboxResume).not.toHaveBeenCalled();
    f.read.entries[0]!.canResume = false; f.controller.refresh(); await flush();
    await f.controller.resume("consumer-a"); expect(f.client.subagentInboxResume).not.toHaveBeenCalled();
  });
  it("keeps unknown outcome visible across reconnect and reuses the exact operation only on explicit retry", async () => {
    const f = fixture(); f.controller.bind(f.client, "taki"); await flush();
    vi.mocked(f.client.subagentInboxResume).mockRejectedValueOnce(new Error("lost"));
    await f.controller.resume("consumer-a"); await flush();
    expect(f.state().feedback).toContain("未能确认");
    const operationKey = vi.mocked(f.client.subagentInboxResume).mock.calls[0]![0].operationKey;
    f.controller.bind(null, "taki"); f.controller.bind(f.client, "taki"); await flush();
    expect(f.client.subagentInboxResume).toHaveBeenCalledOnce();
    await f.controller.resume("consumer-a");
    expect(vi.mocked(f.client.subagentInboxResume).mock.calls[1]![0].operationKey).toBe(operationKey);
  });
});
