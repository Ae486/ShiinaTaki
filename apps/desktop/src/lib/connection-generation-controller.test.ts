import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodeSchema, TIMING_POLICY_DEVELOPMENT_DEFAULTS } from "@taki/shared";
import {
  createConnectionGenerationController,
  type ConnectionClock,
  type ConnectionGenerationClient,
  type ConnectionGenerationContext,
  type ConnectionScheduler,
} from "./connection-generation-controller.ts";
import { createTimingPolicyStore } from "./timing-policy.ts";
import type { ConnectOutcome } from "./ws-client-methods.ts";
import type { WsTransport } from "./ws-transport.ts";

const SCHEDULER: ConnectionScheduler = {
  schedule(delayMs, handler) {
    const timer = setTimeout(handler, delayMs);
    return { cancel: () => clearTimeout(timer) };
  },
};
const CLOCK: ConnectionClock = { now: () => Date.now() };

class FakeTransport implements WsTransport {
  closeCalls = 0;
  send(): void {}
  close(): void {
    this.closeCalls += 1;
  }
  onMessage(): void {}
  onOpen(): void {}
  onClose(): void {}
}

class FakeClient implements ConnectionGenerationClient {
  readonly transport: FakeTransport;
  closeCalls = 0;
  mutationCalls = 0;
  private readonly closeHandlers: Array<() => void> = [];

  constructor(transport: FakeTransport) {
    this.transport = transport;
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  close(): void {
    this.closeCalls += 1;
    this.transport.close();
    this.emitClose();
  }

  emitClose(): void {
    for (const handler of [...this.closeHandlers]) handler();
  }

  mutate(): void {
    this.mutationCalls += 1;
  }
}

interface HarnessOptions {
  authenticate?: (client: FakeClient, index: number) => Promise<ConnectOutcome>;
  recoverAuthFailure?: () => boolean;
  restore?: (client: FakeClient, context: ConnectionGenerationContext) => Promise<void>;
  rng?: () => number;
}

function createHarness(options: HarnessOptions = {}) {
  const transports: FakeTransport[] = [];
  const clients: FakeClient[] = [];
  let authCalls = 0;
  const timingPolicy = createTimingPolicyStore({
    ...TIMING_POLICY_DEVELOPMENT_DEFAULTS,
    reconnectBaseMs: 100,
    reconnectCapMs: 250,
    reconnectStabilityResetMs: 1_000,
  });
  const controller = createConnectionGenerationController<FakeClient>({
    timingPolicy,
    transportFactory: () => {
      const transport = new FakeTransport();
      transports.push(transport);
      return transport;
    },
    clientFactory: ({ transport }) => {
      const client = new FakeClient(transport as FakeTransport);
      clients.push(client);
      return client;
    },
    authenticate: (client) =>
      options.authenticate?.(client, authCalls++) ?? Promise.resolve({ ok: true }),
    recoverAuthFailure: options.recoverAuthFailure,
    restore: options.restore,
    scheduler: SCHEDULER,
    clock: CLOCK,
    rng: options.rng ?? (() => 1),
  });
  return { controller, clients, transports, timingPolicy };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("connection generation promotion and retry", () => {
  it("retires an incompatible display candidate without credential recovery, restoration or retry", async () => {
    const recover = vi.fn(() => true);
    const restore = vi.fn(async () => undefined);
    const message = "Core 版本不支持完整命令审批，请更新 Core 后重试。";
    const h = createHarness({ authenticate: async () => ({ ok: false, code: null, message }), recoverAuthFailure: recover, restore });
    h.controller.start();
    await flush();
    expect(h.controller.snapshot()).toEqual({ client: null, status: { kind: "error", code: null, message } });
    expect(h.clients[0]?.closeCalls).toBe(1);
    expect(recover).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.clients).toHaveLength(1);
    h.controller.dispose();
  });
  it("publishes only authenticated/restored clients and replaces a closed generation with a fresh client", async () => {
    const order: string[] = [];
    const h = createHarness({
      rng: () => 0.5,
      authenticate: async (_client, index) => {
        order.push(`auth-${index}`);
        return { ok: true };
      },
      restore: async (_client, context) => {
        order.push(`restore-${context.generation}`);
      },
    });
    const statuses: string[] = [];
    h.controller.subscribe((snapshot) => statuses.push(snapshot.status.kind));
    h.controller.start();
    expect(h.controller.snapshot().client).toBeNull();
    await flush();
    expect(h.controller.snapshot()).toMatchObject({ client: h.clients[0], status: { kind: "connected" } });

    h.clients[0]?.emitClose();
    expect(h.controller.snapshot()).toEqual({ client: null, status: { kind: "reconnecting" } });
    await vi.advanceTimersByTimeAsync(49);
    expect(h.clients).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();

    expect(h.clients).toHaveLength(2);
    expect(h.clients[1]).not.toBe(h.clients[0]);
    expect(h.transports).toHaveLength(2);
    expect(h.controller.snapshot()).toMatchObject({ client: h.clients[1], status: { kind: "connected" } });
    expect(order).toEqual(["auth-0", "restore-1", "auth-1", "restore-2"]);
    expect(statuses).toEqual(["connecting", "connected", "reconnecting", "connected"]);
  });

  it("applies full jitter, caps exponential retry, and resets only after authenticated stability", async () => {
    const h = createHarness({
      authenticate: async (_client, index) => {
        if (index < 3) throw new Error(`transient-${index}`);
        return { ok: true };
      },
    });
    h.controller.start();
    await flush();
    expect(h.clients).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(h.clients).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(h.clients).toHaveLength(4);
    expect(h.controller.snapshot().status.kind).toBe("connected");

    h.clients[3]?.emitClose();
    await vi.advanceTimersByTimeAsync(249);
    expect(h.clients).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(h.clients).toHaveLength(5);

    await vi.advanceTimersByTimeAsync(1_000);
    h.clients[4]?.emitClose();
    await vi.advanceTimersByTimeAsync(99);
    expect(h.clients).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.clients).toHaveLength(6);
  });

  it("keeps pairing/auth refusals terminal instead of entering a blind retry loop", async () => {
    const pairing = createHarness({
      authenticate: async () => ({ ok: false, code: ErrorCodeSchema.enum.PAIRING_REQUIRED, message: "pair" }),
    });
    pairing.controller.start();
    await flush();
    expect(pairing.controller.snapshot().status).toEqual({ kind: "pairing-required" });
    expect(pairing.clients[0]?.closeCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pairing.clients).toHaveLength(1);

    const refused = createHarness({
      authenticate: async () => ({ ok: false, code: ErrorCodeSchema.enum.AUTH_FAILED, message: "bad token" }),
    });
    refused.controller.start();
    await flush();
    expect(refused.controller.snapshot().status).toEqual({
      kind: "error",
      code: ErrorCodeSchema.enum.AUTH_FAILED,
      message: "bad token",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refused.clients).toHaveLength(1);
  });

  it("recovers one stale operator token before presenting pairing or auth failure", async () => {
    let recovered = 0;
    const h = createHarness({
      authenticate: async (_client, index) =>
        index === 0 ? { ok: false, code: ErrorCodeSchema.enum.AUTH_FAILED, message: "stale" } : { ok: true },
      recoverAuthFailure: () => {
        recovered += 1;
        return true;
      },
    });
    h.controller.start();
    await flush();
    expect(recovered).toBe(1);
    expect(h.clients).toHaveLength(2);
    expect(h.controller.snapshot()).toMatchObject({ client: h.clients[1], status: { kind: "connected" } });
  });

  it("presents a repeated auth refusal after the one-shot recovery attempt", async () => {
    let recovered = 0;
    const h = createHarness({
      authenticate: async () => ({ ok: false, code: ErrorCodeSchema.enum.AUTH_FAILED, message: "still refused" }),
      recoverAuthFailure: () => {
        recovered += 1;
        return true;
      },
    });
    h.controller.start();
    await flush();
    expect(recovered).toBe(1);
    expect(h.clients).toHaveLength(2);
    expect(h.controller.snapshot().status).toEqual({
      kind: "error",
      code: ErrorCodeSchema.enum.AUTH_FAILED,
      message: "still refused",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.clients).toHaveLength(2);
  });

  it("retires a candidate whose required restoration fails and retries with a fresh client", async () => {
    let restoreCalls = 0;
    const h = createHarness({
      restore: async () => {
        restoreCalls += 1;
        if (restoreCalls === 1) throw new Error("required subscription missing");
      },
    });
    h.controller.start();
    await flush();
    expect(h.controller.snapshot()).toEqual({ client: null, status: { kind: "reconnecting" } });
    expect(h.clients[0]?.closeCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(h.clients).toHaveLength(2);
    expect(restoreCalls).toBe(2);
    expect(h.controller.snapshot()).toMatchObject({ client: h.clients[1], status: { kind: "connected" } });
  });
});

describe("connection generation disposal and stale continuations", () => {
  it("disposes during backoff without creating another generation", async () => {
    const h = createHarness({ authenticate: async () => Promise.reject(new Error("offline")) });
    h.controller.start();
    await flush();
    expect(h.controller.snapshot().status.kind).toBe("reconnecting");
    h.controller.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.clients).toHaveLength(1);
  });

  it("disposes a candidate during open/auth and ignores its late completion", async () => {
    const auth = deferred<ConnectOutcome>();
    let restoreCalls = 0;
    const h = createHarness({
      authenticate: async () => auth.promise,
      restore: async () => {
        restoreCalls += 1;
      },
    });
    h.controller.start();
    h.controller.dispose();
    auth.resolve({ ok: true });
    await flush();
    expect(h.clients[0]?.closeCalls).toBe(1);
    expect(restoreCalls).toBe(0);
    expect(h.controller.snapshot().status.kind).toBe("connecting");
  });

  it("disposes during restoration and prevents a late promotion", async () => {
    const restoration = deferred<void>();
    const h = createHarness({ restore: async () => restoration.promise });
    h.controller.start();
    await flush();
    expect(h.controller.snapshot().client).toBeNull();
    h.controller.dispose();
    restoration.resolve();
    await flush();
    expect(h.clients[0]?.closeCalls).toBe(1);
    expect(h.controller.snapshot().status.kind).toBe("connecting");
  });

  it("ignores a retired generation's late authentication after a replacement is connected", async () => {
    const firstAuth = deferred<ConnectOutcome>();
    const h = createHarness({
      authenticate: async (_client, index) => (index === 0 ? firstAuth.promise : { ok: true }),
    });
    h.controller.start();
    h.clients[0]?.emitClose();
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(h.controller.snapshot()).toMatchObject({ client: h.clients[1], status: { kind: "connected" } });
    firstAuth.resolve({ ok: true });
    await flush();
    expect(h.clients).toHaveLength(2);
    expect(h.controller.snapshot()).toMatchObject({ client: h.clients[1], status: { kind: "connected" } });
  });

  it("ignores duplicate late close callbacks and never replays a mutation on the replacement", async () => {
    const h = createHarness();
    h.controller.start();
    await flush();
    h.controller.snapshot().client?.mutate();
    h.clients[0]?.emitClose();
    h.clients[0]?.emitClose();
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(h.clients).toHaveLength(2);
    expect(h.clients[0]?.mutationCalls).toBe(1);
    expect(h.clients[1]?.mutationCalls).toBe(0);
  });
});
