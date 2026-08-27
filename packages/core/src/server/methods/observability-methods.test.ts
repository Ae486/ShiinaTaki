import { describe, expect, it, vi } from "vitest";
import { OBSERVABILITY_METHODS, type RunEvent } from "@taki/shared";
import { createRunEventLiveBus } from "../../db/run-event-live.ts";
import type { ObservabilityQueryService } from "../../observability/observability-query-service.ts";
import { createConnectionRegistry } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerObservabilityMethods } from "./observability-methods.ts";

const event = (seq: number): RunEvent => ({ eventId: `event-${seq}`, runId: "run", seq,
  schemaVersion: "run-event.v1", category: "lifecycle", kind: "run.started",
  occurredAt: "2026-08-27T00:00:00.000Z", source: "core.run-repo",
  payload: { kind: "run.started", state: "running", operationPhase: "executing" } });
const row = (seq: number) => ({ rowKey: `event-${seq}`, seq, label: "Run Started", phase: "run" as const,
  category: "lifecycle" as const, status: "Running", occurredAt: "2026-08-27T00:00:00.000Z", surface: "current" as const,
  kind: "lifecycle" as const });

function fixture() {
  const registry = createMethodRegistry(); const live = createRunEventLiveBus();
  let mode: "DISABLED" | "FEEDBACK_ONLY" = "FEEDBACK_ONLY";
  const service = { mode: () => mode, project: (item: RunEvent) => row(item.seq),
    list: vi.fn(), inspect: vi.fn(), trajectory: vi.fn().mockImplementation(({ afterSeq }) => ({
      run: { key: "run", characterId: "taki", title: "Primary · Running", initiator: "primary", initiatorLabel: "Primary",
        triggerLabel: "Chat", deliveryClass: "class_a", deliveryLabel: "Class A delivery", state: "running",
        queuedAt: "2026-08-27T00:00:00.000Z", attemptCount: 1, effectCount: 0,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      rows: afterSeq === 0 ? [row(1)] : [], cursor: { runKey: "run", seq: Math.max(afterSeq, 1) }, hasMore: false,
    })) } as unknown as ObservabilityQueryService;
  registerObservabilityMethods(registry, { service, live });
  const connections = createConnectionRegistry(); const connection = connections.create();
  connections.authenticate(connection, { deviceId: "owner", role: "operator", capabilities: [] });
  const notifications: Array<{ method: string; params: unknown }> = []; const closeHandlers: Array<() => void> = [];
  const context: MethodContext = { connection, notify: (method, params) => notifications.push({ method, params }),
    close: () => undefined, onClose: (handler) => closeHandlers.push(handler) };
  return { registry, live, notifications, closeHandlers, service, setMode: (next: typeof mode) => { mode = next; }, context };
}

describe("observability methods", () => {
  it("backfills before live delivery and disposes on connection close", async () => {
    const f = fixture();
    await f.registry.dispatch({ jsonrpc: "2.0", id: 1, method: OBSERVABILITY_METHODS.subscribe,
      params: { characterId: "taki", runKey: "run", afterSeq: 0 } }, f.context);
    expect(f.notifications.map((item) => (item.params as { cursor: number }).cursor)).toEqual([1]);
    f.live.publish([event(2)]); await Promise.resolve(); await Promise.resolve();
    expect(f.notifications.map((item) => (item.params as { cursor: number }).cursor)).toEqual([1, 2]);
    f.closeHandlers.forEach((handler) => handler()); f.live.publish([event(3)]); await Promise.resolve();
    expect(f.notifications).toHaveLength(2);
  });

  it("replaces the prior connection-scoped subscription and stops when mode disables", async () => {
    const f = fixture();
    const request = { jsonrpc: "2.0" as const, id: 1, method: OBSERVABILITY_METHODS.subscribe,
      params: { characterId: "taki", runKey: "run", afterSeq: 1 } };
    await f.registry.dispatch(request, f.context); await f.registry.dispatch({ ...request, id: 2 }, f.context);
    f.live.publish([event(2)]); await Promise.resolve(); await Promise.resolve();
    expect(f.notifications.filter((item) => (item.params as { cursor: number }).cursor === 2)).toHaveLength(1);
    f.setMode("DISABLED"); f.live.publish([event(3)]); await Promise.resolve(); await Promise.resolve();
    expect(f.notifications.at(-1)?.params).toMatchObject({ invalidated: true, reason: "mode-disabled" });
  });

  it("allows the client to explicitly release its connection-scoped subscription", async () => {
    const f = fixture();
    await f.registry.dispatch({ jsonrpc: "2.0", id: 1, method: OBSERVABILITY_METHODS.subscribe,
      params: { characterId: "taki", runKey: "run", afterSeq: 1 } }, f.context);
    await f.registry.dispatch({ jsonrpc: "2.0", id: 2, method: OBSERVABILITY_METHODS.unsubscribe, params: {} }, f.context);
    f.live.publish([event(2)]); await Promise.resolve(); await Promise.resolve();
    expect(f.notifications).toHaveLength(0);
  });
});
