import { describe, expect, it, vi } from "vitest";
import type { McpClient } from "./mcp-connect.ts";
import { acquireLease, closeGeneration, makeGenerationRecord, releaseLease, retireGeneration } from "./mcp-generations.ts";

describe("MCP immediate closed-state observation", () => {
  it("observes closed state once before deferred transport cleanup and preserves the cleanup callback", async () => {
    let finishClose = (): void => undefined;
    const closing = new Promise<void>((resolve) => { finishClose = resolve; });
    const client = { close: vi.fn(() => closing) } as unknown as McpClient;
    const cleanup = vi.fn();
    const observed: { closed: boolean; timer: unknown; cleanupCount: number; joinedClose: Promise<void> }[] = [];
    const stateChanged = vi.fn(() => { observed.push({ closed: record.closed, timer: record.closeTimer, cleanupCount: cleanup.mock.calls.length, joinedClose: closeGeneration(record) }); });
    const record = makeGenerationRecord({
      serverId: "srv", ownerHostId: "owner", configRevision: 1, generation: 1,
      client, tools: {}, refs: new Map(), secretRefs: new Set(), onClosed: cleanup, onClosedState: stateChanged,
    });
    expect(acquireLease(record)).toBe(true);
    releaseLease(record);
    expect(stateChanged).not.toHaveBeenCalled();
    retireGeneration(record, 1_000);
    expect(stateChanged).toHaveBeenCalledExactlyOnceWith(["mcp"]);
    expect(observed).toEqual([{ closed: true, timer: null, cleanupCount: 0, joinedClose: record.closePromise }]);
    expect(cleanup).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledTimes(1);
    finishClose();
    await record.closePromise;
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(record);
    expect(stateChanged).toHaveBeenCalledTimes(1);
  });

  it("publishes force-closed truth at the deadline while keeping unknown-outcome leases and cleanup", async () => {
    vi.useFakeTimers();
    try {
      let finishClose = (): void => undefined;
      const closing = new Promise<void>((resolve) => { finishClose = resolve; });
      const observed: { closed: boolean; forced: boolean; leases: number }[] = [];
      const record = makeGenerationRecord({
        serverId: "srv", ownerHostId: "owner", configRevision: 1, generation: 1,
        client: { close: () => closing } as McpClient, tools: {}, refs: new Map(), secretRefs: new Set(),
        onClosedState: () => { observed.push({ closed: record.closed, forced: record.forcedClosed, leases: record.leases }); throw new Error("observer"); },
      });
      acquireLease(record);
      retireGeneration(record, 25);
      await vi.advanceTimersByTimeAsync(25);
      expect(observed).toEqual([{ closed: true, forced: true, leases: 1 }]);
      expect(acquireLease(record)).toBe(false);
      releaseLease(record);
      expect(observed).toHaveLength(1);
      finishClose();
      await record.closePromise;
    } finally { vi.useRealTimers(); }
  });
});
