import { describe, expect, it, vi } from "vitest";
import { CONFIG_METHODS, TIMING_CONFIG_KEYS, TIMING_POLICY_DEVELOPMENT_DEFAULTS,
  type ConfigListResult, type TimingPolicyField } from "@taki/shared";
import { createWsClient } from "./ws-client.ts";
import { createTimingPolicyStore } from "./timing-policy.ts";
import { createReadCoordinator } from "./read-coordinator.ts";
import { createConfigObserver } from "../windows/home/pages/settings/config-observer.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const KEY = "TAKI_AGENT_MAX_STEPS";

function listing(value: number): ConfigListResult {
  const policy = TIMING_POLICY_DEVELOPMENT_DEFAULTS;
  const entry = { key: KEY, value, default: 25, stored: true, envLocked: false, apply: "live" as const,
    secret: false, secretSet: false, input: { kind: "int" as const, min: 1 }, description: "steps" };
  return { entries: [entry, ...Object.entries(TIMING_CONFIG_KEYS).map(([field, key]) => ({
    ...entry, key, value: policy[field as TimingPolicyField], default: policy[field as TimingPolicyField], stored: false,
  }))] };
}

function harness(withTiming = false) {
  const messages: Array<(data: string) => void> = [];
  const opens: Array<() => void> = [];
  const closes: Array<() => void> = [];
  const sent: Array<{ id: number; method: string }> = [];
  const client = createWsClient({
    transport: {
      send: (payload) => sent.push(JSON.parse(payload)),
      onMessage: (handler) => messages.push(handler), onOpen: (handler) => opens.push(handler),
      onClose: (handler) => closes.push(handler), close: () => closes.forEach((handler) => handler()),
    },
    ...(withTiming ? { timingPolicy: createTimingPolicyStore(), onTimingPolicyDiagnostic: vi.fn() } : {}),
  });
  const deliver = (frame: unknown) => messages.forEach((handler) => handler(JSON.stringify(frame)));
  const request = (method: string, index: number) => sent.filter((frame) => frame.method === method)[index]!;
  const respond = (id: number, result: unknown) => deliver({ jsonrpc: "2.0", id, result });
  opens.forEach((handler) => handler());
  return { client, sent, deliver, request, respond };
}

describe("physical config-list sharing coverage", () => {
  it("gives a new Settings observer a post-push read while the existing timing owner still holds an older list", async () => {
    const h = harness(true);
    const connecting = h.client.connect({ deviceId: "home", deviceName: "Home", role: "operator", capabilities: [] });
    await flush();
    h.respond(h.request("connect", 0).id, { status: "ok", token: "synthetic" });
    await connecting;
    h.respond(h.request(CONFIG_METHODS.subscribe, 0).id, { status: "ok" });
    await flush();
    const oldId = h.request(CONFIG_METHODS.list, 0).id;
    h.deliver({ jsonrpc: "2.0", method: CONFIG_METHODS.changed, params: { key: KEY, value: 88 } });

    let view: ConfigListResult | null = null;
    const gap = vi.fn();
    const failed = vi.fn();
    const reads = createReadCoordinator<ConfigListResult>({
      started: vi.fn(), loaded: (result) => { view = result; }, failed, retired: vi.fn(),
    });
    const observer = createConfigObserver({ client: h.client, visible: () => true, gap,
      apply: () => reads.acceptUpdate(), demand: () => reads.demand() });
    const stop = observer.start();
    reads.replace(observer.read);
    const done = reads.demand();
    try {
      await flush();
      expect(h.sent.filter((frame) => frame.method === CONFIG_METHODS.list)).toHaveLength(2);
      h.respond(h.request(CONFIG_METHODS.list, 1).id, listing(88));
      await done;
      expect(view).toEqual(listing(88));
      expect(gap).toHaveBeenLastCalledWith(false);
      h.respond(oldId, listing(25));
      await flush();
      expect(view).toEqual(listing(88));
      expect(h.sent.filter((frame) => frame.method === CONFIG_METHODS.list)).toHaveLength(2);
      expect(h.sent.filter((frame) => frame.method === CONFIG_METHODS.subscribe)).toHaveLength(1);
      expect(failed).not.toHaveBeenCalled();
    } finally { stop(); reads.retire(); h.client.close(); await done; }
  });

  it.each(["success", "failure"])("does not let an obsolete list's %s finalizer retire a newer shared flight", async (outcome) => {
    const h = harness();
    const old = h.client.configList();
    const settled = old.then(() => undefined, () => undefined);
    const oldId = h.request(CONFIG_METHODS.list, 0).id;
    h.deliver({ jsonrpc: "2.0", method: CONFIG_METHODS.changed, params: { key: KEY, value: 88 } });
    const current = h.client.configList();
    const currentHandled = current.catch(() => undefined);
    try {
      expect(h.sent).toHaveLength(2);
      if (outcome === "success") h.respond(oldId, listing(25));
      else h.deliver({ jsonrpc: "2.0", id: oldId, error: { code: -32_000, message: "old failed read" } });
      await settled;
      expect(h.client.configList()).toBe(current);
      expect(h.sent).toHaveLength(2);
      h.respond(h.request(CONFIG_METHODS.list, 1).id, listing(88));
      expect(await current).toEqual(listing(88));
    } finally { h.client.close(); await Promise.all([settled, currentHandled]); }
  });

  it("retires earlier list sharing after a verified successful config write without requiring a push", async () => {
    const h = harness();
    const old = h.client.configList();
    const settled = old.catch(() => undefined);
    const write = h.client.configSet({ key: KEY, value: 88 });
    h.respond(h.request(CONFIG_METHODS.set, 0).id, { status: "ok", key: KEY, value: 88, apply: "live" });
    await write;
    const current = h.client.configList();
    const currentHandled = current.catch(() => undefined);
    try {
      expect(h.sent.filter((frame) => frame.method === CONFIG_METHODS.list)).toHaveLength(2);
      h.respond(h.request(CONFIG_METHODS.list, 1).id, listing(88));
      expect(await current).toEqual(listing(88));
      h.respond(h.request(CONFIG_METHODS.list, 0).id, listing(25));
      expect(await old).toEqual(listing(25));
    } finally { h.client.close(); await Promise.all([settled, currentHandled]); }
  });

  it("does not retire list sharing on an invalid push or a refused write", async () => {
    const h = harness();
    const old = h.client.configList();
    const settled = old.catch(() => undefined);
    h.deliver({ jsonrpc: "2.0", method: CONFIG_METHODS.changed, params: { key: KEY, value: { invalid: true } } });
    const write = h.client.configSet({ key: KEY, value: 88 });
    const rejected = expect(write).rejects.toThrow();
    h.deliver({ jsonrpc: "2.0", id: h.request(CONFIG_METHODS.set, 0).id, error: { code: -32_000, message: "refused" } });
    await rejected;
    try {
      expect(h.client.configList()).toBe(old);
      expect(h.sent.filter((frame) => frame.method === CONFIG_METHODS.list)).toHaveLength(1);
      h.respond(h.request(CONFIG_METHODS.list, 0).id, listing(25));
      await old;
    } finally { h.client.close(); await settled; }
  });

  it("does not share a pre-recovery list as a newly acknowledged subscription baseline", async () => {
    const h = harness();
    const setup = h.client.subscribeConfig();
    const rejected = expect(setup).rejects.toThrow();
    h.deliver({ jsonrpc: "2.0", id: h.request(CONFIG_METHODS.subscribe, 0).id, error: { code: -32_000, message: "lost setup" } });
    await rejected;
    const old = h.client.configList();
    const settled = old.catch(() => undefined);
    const recovered = h.client.subscribeConfig();
    h.respond(h.request(CONFIG_METHODS.subscribe, 1).id, { status: "ok" });
    await recovered;
    const current = h.client.configList();
    const currentHandled = current.catch(() => undefined);
    try {
      expect(current).not.toBe(old);
      expect(h.sent.filter((frame) => frame.method === CONFIG_METHODS.list)).toHaveLength(2);
      h.respond(h.request(CONFIG_METHODS.list, 1).id, listing(88));
      await current;
      h.respond(h.request(CONFIG_METHODS.list, 0).id, listing(25));
      await old;
    } finally { h.client.close(); await Promise.all([settled, currentHandled]); }
  });
});
