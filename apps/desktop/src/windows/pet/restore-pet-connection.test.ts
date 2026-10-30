import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TIMING_POLICY_DEVELOPMENT_DEFAULTS,
  type AvatarCommand,
  type AvatarOutcomeParams,
  type AvatarReportParams,
  type ChatActivityReadResult,
} from "@taki/shared";
import {
  createConnectionGenerationController,
  type ConnectionGenerationClient,
  type ConnectionGenerationContext,
  type ConnectionScheduler,
} from "@/lib/connection-generation-controller.js";
import { createCostumeReportSyncTracker } from "@/lib/costume-report-sync.js";
import { createTimingPolicyStore } from "@/lib/timing-policy.js";
import type { WsTransport } from "@/lib/ws-transport.js";
import { restorePetConnection } from "./restore-pet-connection.ts";

const EXPRESSION: AvatarCommand = { characterId: "taki", commandId: "expression-test", kind: "expression", name: "smile" };
const MOTION: AvatarCommand = { characterId: "taki", commandId: "motion-test", kind: "motion", name: "wave", priority: "normal" };

class AvatarClient implements ConnectionGenerationClient {
  readonly order: string[] = [];
  readonly reports: AvatarReportParams[] = [];
  subscribeCalls = 0;
  closeCalls = 0;
  failAt: "report" | "subscribe" | null = null;
  private avatarHandler: ((command: AvatarCommand) => void) | null = null;
  private readonly closeHandlers: Array<() => void> = [];

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  close(): void {
    this.closeCalls += 1;
    this.emitClose();
  }

  emitClose(): void {
    for (const handler of [...this.closeHandlers]) handler();
  }

  onAvatarCommand(handler: (command: AvatarCommand) => void): void {
    this.order.push("handler");
    this.avatarHandler = handler;
  }

  onChatActivity(): () => void {
    this.order.push("activity-handler");
    return () => undefined;
  }

  async subscribeTimeline(): Promise<void> {
    this.order.push("timeline-subscribe");
  }

  async chatActivityRead(): Promise<ChatActivityReadResult> {
    this.order.push("activity-read");
    return { characterId: "taki", status: "idle" };
  }

  onTimelineAppended(): void {}
  onTimelineRemoved(): void {}
  onTimelineCommitted(): () => void { return () => undefined; }
  async timelineHistory() { return { entries: [], nextBefore: null }; }

  async reportAvatar(params: AvatarReportParams): Promise<void> {
    this.order.push("report");
    this.reports.push(params);
    if (this.failAt === "report") throw new Error("report failed");
  }

  readonly outcomes: AvatarOutcomeParams[] = [];
  outcomeFails = false;
  async reportAvatarOutcome(params: AvatarOutcomeParams): Promise<void> {
    this.order.push("outcome");
    if (this.outcomeFails) throw new Error("outcome rpc failed");
    this.outcomes.push(params);
  }

  async subscribeAvatar(): Promise<void> {
    this.order.push("subscribe");
    this.subscribeCalls += 1;
    if (this.failAt === "subscribe") throw new Error("subscribe failed");
  }

  deliver(command: AvatarCommand): void {
    this.avatarHandler?.(command);
  }
}

function context(isCurrent: () => boolean): ConnectionGenerationContext {
  return { generation: 1, isCurrent };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("restorePetConnection", () => {
  it("keeps the Pet socket restorable while the renderer scene is unavailable", async () => {
    const client = new AvatarClient();
    await restorePetConnection({ client, scene: null, context: context(() => true) });

    expect(client.order).toEqual(["handler", "report", "subscribe", "activity-handler", "timeline-subscribe", "activity-read"]);
    expect(client.reports).toEqual([{ characterId: "taki", motions: [], expressions: [] }]);
    expect(client.subscribeCalls).toBe(1);
  });

  it("installs the guarded callback before a truthful report and one observed subscription", async () => {
    const client = new AvatarClient();
    const reportSync = createCostumeReportSyncTracker();
    const applied: AvatarCommand[] = [];
    const scene = {
      reportSnapshot: () => ({ motions: ["wave"], expressions: ["smile"], costume: "arbeit" }),
      applyAvatarCommand: async (command: AvatarCommand) => { applied.push(command); return { outcome: "applied" as const }; },
    };
    await restorePetConnection({ client, scene, context: context(() => true), reportSync });
    client.deliver(EXPRESSION);
    client.deliver(MOTION);
    await flush();

    expect(client.order).toEqual(["handler", "report", "subscribe", "activity-handler", "timeline-subscribe", "activity-read", "outcome", "outcome"]);
    expect(client.reports).toEqual([
      { characterId: "taki", motions: ["wave"], expressions: ["smile"], costume: "arbeit" },
    ]);
    expect(client.subscribeCalls).toBe(1);
    expect(applied).toEqual([EXPRESSION, MOTION]);
    expect(client.outcomes).toEqual([
      { characterId: "taki", commandId: "expression-test", outcome: "applied" },
      { characterId: "taki", commandId: "motion-test", outcome: "applied" },
    ]);
    expect(reportSync.snapshot()).toEqual({ kind: "synced", costumeId: "arbeit", source: "reconnect" });
  });

  it("reports a rejection with its reason for the received commandId", async () => {
    const client = new AvatarClient();
    await restorePetConnection({
      client,
      scene: {
        reportSnapshot: () => ({ motions: [], expressions: [] }),
        applyAvatarCommand: async () => ({ outcome: "rejected" as const, reason: "motion_busy" as const }),
      },
      context: context(() => true),
    });
    client.deliver(MOTION);
    await flush();
    expect(client.outcomes).toEqual([{ characterId: "taki", commandId: "motion-test", outcome: "rejected", reason: "motion_busy" }]);
  });

  it("stays silent when the generation retires while the command is being applied", async () => {
    let current = true;
    const client = new AvatarClient();
    await restorePetConnection({
      client,
      scene: {
        reportSnapshot: () => ({ motions: [], expressions: [] }),
        applyAvatarCommand: async () => { current = false; return { outcome: "applied" as const }; },
      },
      context: context(() => current),
    });
    client.deliver(EXPRESSION);
    await flush();
    expect(client.outcomes).toEqual([]);
    expect(client.order).not.toContain("outcome");
  });

  it("logs an outcome RPC failure instead of throwing out of the gate", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = new AvatarClient();
    client.outcomeFails = true;
    await restorePetConnection({
      client,
      scene: { reportSnapshot: () => ({ motions: [], expressions: [] }), applyAvatarCommand: async () => ({ outcome: "applied" as const }) },
      context: context(() => true),
    });
    expect(() => client.deliver(EXPRESSION)).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalledWith("[pet] avatar outcome report failed", expect.any(Error));
    warn.mockRestore();
  });

  it.each(["report", "subscribe"] as const)("propagates an observed %s failure", async (failAt) => {
    const client = new AvatarClient();
    client.failAt = failAt;
    const restoring = restorePetConnection({
      client,
      scene: { reportSnapshot: () => ({ motions: [], expressions: [] }), applyAvatarCommand: vi.fn() },
      context: context(() => true),
    });
    await expect(restoring).rejects.toThrow(`${failAt} failed`);
  });

  it("re-reports the committed in-memory snapshot and clears a prior report recovery need", async () => {
    const reportSync = createCostumeReportSyncTracker();
    const failedSwitch = reportSync.begin("arbeit", "switch");
    reportSync.recoveryNeeded(failedSwitch, new Error("outcome unknown"));
    const client = new AvatarClient();

    await restorePetConnection({
      client,
      reportSync,
      scene: {
        reportSnapshot: () => ({ motions: ["wave"], expressions: ["smile"], costume: "arbeit" }),
        applyAvatarCommand: vi.fn(),
      },
      context: context(() => true),
    });

    expect(client.reports.at(-1)).toEqual({
      characterId: "taki",
      motions: ["wave"],
      expressions: ["smile"],
      costume: "arbeit",
    });
    expect(reportSync.snapshot()).toEqual({ kind: "synced", costumeId: "arbeit", source: "reconnect" });
  });

  it("ignores commands from a retired generation", async () => {
    let current = true;
    const client = new AvatarClient();
    const applyAvatarCommand = vi.fn();
    await restorePetConnection({
      client,
      scene: { reportSnapshot: () => ({ motions: [], expressions: [] }), applyAvatarCommand },
      context: context(() => current),
    });
    current = false;
    client.deliver(EXPRESSION);
    expect(applyAvatarCommand).not.toHaveBeenCalled();
  });
});

describe("accelerated long-idle avatar recovery", () => {
  afterEach(() => vi.useRealTimers());

  it("reconnects only Pet, restores once, delivers once, and leaves independent Home Chat usable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const clients: AvatarClient[] = [];
    const applied: AvatarCommand[] = [];
    const homeChat = { sends: 0, send: () => (homeChat.sends += 1) };
    const timingPolicy = createTimingPolicyStore({
      ...TIMING_POLICY_DEVELOPMENT_DEFAULTS,
      reconnectBaseMs: 100,
      reconnectCapMs: 100,
    });
    const scheduler: ConnectionScheduler = {
      schedule(delayMs, handler) {
        const timer = setTimeout(handler, delayMs);
        return { cancel: () => clearTimeout(timer) };
      },
    };
    const controller = createConnectionGenerationController<AvatarClient>({
      timingPolicy,
      transportFactory: () => ({
        send: () => undefined,
        close: () => undefined,
        onMessage: () => undefined,
        onOpen: () => undefined,
        onClose: () => undefined,
      }) satisfies WsTransport,
      clientFactory: () => {
        const client = new AvatarClient();
        clients.push(client);
        return client;
      },
      authenticate: async () => ({ ok: true }),
      restore: (client, generation) =>
        restorePetConnection({
          client,
          context: generation,
          scene: {
            reportSnapshot: () => ({ motions: ["wave"], expressions: ["smile"], costume: "arbeit" }),
            applyAvatarCommand: async (command) => { applied.push(command); return { outcome: "applied" as const }; },
          },
        }),
      scheduler,
      clock: { now: () => Date.now() },
      rng: () => 1,
    });

    controller.start();
    await flush();
    clients[0]?.deliver(EXPRESSION);
    clients[0]?.deliver(MOTION);
    homeChat.send();
    clients[0]?.emitClose();
    homeChat.send();
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    clients[1]?.deliver(EXPRESSION);
    clients[1]?.deliver(MOTION);
    clients[0]?.deliver(EXPRESSION);
    await flush();

    expect(homeChat.sends).toBe(2);
    expect(clients).toHaveLength(2);
    expect(clients.map((client) => client.order.filter((step) => step !== "outcome"))).toEqual([
      ["handler", "report", "subscribe", "activity-handler", "timeline-subscribe", "activity-read"],
      ["handler", "report", "subscribe", "activity-handler", "timeline-subscribe", "activity-read"],
    ]);
    // Outcomes ride only the generation that received the command AND is still current when the apply resolves: the
    // first socket was retired in the same tick as its deliveries, so it reports nothing; the replacement reports its own two.
    expect(clients.map((client) => client.outcomes.map((outcome) => outcome.commandId))).toEqual([
      [],
      ["expression-test", "motion-test"],
    ]);
    expect(clients.map((client) => client.subscribeCalls)).toEqual([1, 1]);
    expect(applied).toEqual([EXPRESSION, MOTION, EXPRESSION, MOTION]);
    expect(controller.snapshot().status.kind).toBe("connected");
  });
});
