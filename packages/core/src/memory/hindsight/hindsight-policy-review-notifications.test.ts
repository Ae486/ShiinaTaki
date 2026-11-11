import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JsonRpcSuccessResponseSchema, MemoryAuthorityStatusSchema, MEMORY_AUTHORITY_METHODS,
  MEMORY_OPERATION_METHODS, MEMORY_REPLICA_METHODS, type MemoryReplicaChanged } from "@taki/shared";
import { composeHindsightSetup } from "../../boot/hindsight-setup-boot.ts";
import { createDeviceRegistry } from "../../devices/device-registry.ts";
import { createPairedDeviceStore } from "../../devices/paired-device-store.ts";
import { createConnectionRegistry } from "../../server/connection-registry.ts";
import { createMethodRegistry } from "../../server/method-registry.ts";
import { createConnectionSubscriptions, createMemoryOperationSubscriptions } from "../../server/memory-operation-subscriptions.ts";
import { connectMethod } from "../../server/methods/connect.ts";
import { memoryAuthorityStatusMethod } from "../../server/methods/memory-authority-status.ts";
import { registerMemoryOperationMethods } from "../../server/methods/memory-operation-methods.ts";
import { startWsServer } from "../../server/ws-server.ts";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { notification, openClient, sendConnect, type TestClient } from "../../testing/ws-test-client.ts";
import { readMemoryAuthorityStatus } from "../operations/memory-authority-status.ts";
import { createMemoryOperationService } from "../operations/memory-operation-service.ts";
import { createMemoryStatusObserver } from "../operations/memory-status-observer.ts";
import { curatorTestAssessDriver } from "./hindsight-policy-curator-fixtures.ts";
import * as modelDriver from "./hindsight-policy-curator-model.ts";
import { readHindsightLiveConnection } from "./hindsight-runtime-connection.ts";

// Failure modes: saved answers are invisible while a later model response is held; hints use a different
// channel from operations.subscribe; dead subscribers block live ones; reconnect reads stale authority counts.
async function request(client: TestClient, method: string, notes: Array<ReturnType<typeof notification>>) {
  client.send({ jsonrpc: "2.0", id: method, method, params: {} });
  for (;;) {
    const [frame] = await client.take(1);
    if (frame && typeof frame === "object" && "id" in frame) return JsonRpcSuccessResponseSchema.parse(frame).result;
    notes.push(notification(frame));
  }
}

describe("committed policy review hints over the registered live WS path", () => {
  it("pushes saved and terminal progress to subscribed sockets and reconstructs it after reconnect", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const channel = createConnectionSubscriptions<MemoryReplicaChanged>();
    const hints: string[] = [];
    const f = hindsightRuntimeFixture({ onPolicyReviewChanged: (bankId) => { hints.push(bankId); channel.publish({ bankId }); } });
    f.config.upsert("TAKI_HINDSIGHT_POLICY_REVIEW_THRESHOLD", 1);
    const runtime = f.compose(); const registry = createMethodRegistry();
    const subscriptions = createMemoryOperationSubscriptions();
    const setup = composeHindsightSetup({ db: f.db, config: f.source, secrets: f.secrets.catalog, registry, logger: f.logger });
    const operations = createMemoryOperationService({ db: f.db, live: runtime.operations, setup, bootId: f.bootId,
      onChanged: subscriptions.publish, logger: f.logger });
    const observer = createMemoryStatusObserver({ db: f.db, runtime });
    registerMemoryOperationMethods(registry, { service: operations, subscriptions, replicaSubscriptions: channel, logger: f.logger });
    registry.register(memoryAuthorityStatusMethod({ logger: f.logger, read: () => {
      const view = observer.readRuntime();
      return readMemoryAuthorityStatus({ db: f.db, live: runtime.operations, setup, operations,
        liveConnection: () => readHindsightLiveConnection({ config: f.source, secrets: f.secrets.catalog }) }, view.selection, view);
    } }));
    const connections = createConnectionRegistry();
    registry.register(connectMethod({ connectionRegistry: connections,
      deviceRegistry: createDeviceRegistry({ store: createPairedDeviceStore(join(f.dataDir, "devices.json")) }),
      trustLoopbackOperator: true, onPairingCode: () => undefined, onAutoTrust: () => undefined }));
    const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry: connections, logger: f.logger });
    const clients: TestClient[] = [];
    const connect = async (lastDigit: string) => {
      const client = await openClient(`ws://127.0.0.1:${server.port}`); clients.push(client);
      sendConnect(client, { role: "operator", deviceId: `550e8400-e29b-41d4-a716-44665544000${lastDigit}`, deviceName: "review-fixture" });
      expect(JsonRpcSuccessResponseSchema.parse((await client.take(1))[0]).result).toMatchObject({ status: "ok" });
      await request(client, MEMORY_OPERATION_METHODS.subscribe, []); return client;
    };
    let release!: () => void; let saved!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { saved = resolve; });
    let first = true;
    const driver = vi.spyOn(modelDriver, "runHindsightPolicyCuratorModel").mockImplementation(async (input) => {
      const result = await curatorTestAssessDriver(input);
      if (first) { first = false; saved(); await held; } return result;
    });
    try {
      const a = await connect("0"); const b = await connect("1");
      channel.subscribe({ state: { status: "authenticated", role: "operator", deviceId: "dead", capabilities: [] } },
        () => { throw new Error("dead subscriber"); });
      const scheduler = runtime.operations()!.scheduler;
      for (const bank of runtime.operations()!.banks()) scheduler.configure(bank.bankId,
        { automatic: false, autoIntervalMs: 21_600_000, fullReconciliationIntervalMs: 604_800_000 });
      vi.setSystemTime(Date.now() + 10_000); runtime.start(); await scheduler.tick(); await ready;
      const notesA: Array<ReturnType<typeof notification>> = []; const notesB: Array<ReturnType<typeof notification>> = [];
      const read = async (client: TestClient, notes = notesA) =>
        MemoryAuthorityStatusSchema.parse(await request(client, MEMORY_AUTHORITY_METHODS.status, notes));
      expect((await read(a)).review?.[0]).toMatchObject({ bankId: f.banks[0]!.scope.bankId,
        state: "running", eligibleRemaining: null, savedAwaitingPublication: 2 });
      expect((await read(b, notesB)).review?.[0]?.savedAwaitingPublication).toBe(2);
      expect(notesA).toEqual(notesB);
      expect(notesA.length).toBeGreaterThanOrEqual(3);
      expect(notesA.every((note) => note.method === MEMORY_REPLICA_METHODS.changed)).toBe(true);
      release();
      await vi.waitFor(() => expect(driver).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(readMemoryAuthorityStatus({ db: f.db, live: runtime.operations, setup, operations,
        liveConnection: () => readHindsightLiveConnection({ config: f.source, secrets: f.secrets.catalog }) }).review)
        .toEqual(expect.arrayContaining([expect.objectContaining({ bankId: "bank-taki", state: null, savedAwaitingPublication: 0 })])));
      expect((await read(a)).review?.every((row) => row.state === null && row.savedAwaitingPublication === 0
        && row.eligibleRemaining === 0 && row.lastCompletedAt !== null)).toBe(true);
      b.close(); await b.waitClosed(); await vi.waitFor(() => expect(channel.count()).toBe(2));
      const reopened = await connect("2");
      expect((await read(reopened)).review).toEqual((await read(a)).review);
      const beforeStop = hints.length; await runtime.stop();
      expect(hints).toHaveLength(beforeStop);
    } finally {
      release(); driver.mockRestore(); for (const client of clients) client.close();
      await server.close(); observer.close(); await operations.stop(); await f.close(); vi.useRealTimers();
    }
  });
});
