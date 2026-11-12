import { describe, expect, it, vi } from "vitest";
import {
  TIMING_CONFIG_KEYS,
  TIMING_POLICY_DEVELOPMENT_DEFAULTS,
  type ConfigChanged,
  type ConfigEntry,
  type TimingPolicy,
  type TimingPolicyField,
} from "@taki/shared";
import { createTimingPolicyStore } from "./timing-policy.ts";
import { createTimingPolicySync } from "./timing-policy-sync.ts";

const FIELDS = Object.keys(TIMING_CONFIG_KEYS) as TimingPolicyField[];

function entries(policy: TimingPolicy): ConfigEntry[] {
  return FIELDS.map((field) => ({
    key: TIMING_CONFIG_KEYS[field],
    value: policy[field],
    stored: false,
    envLocked: false,
    default: policy[field],
    apply: "live",
    secret: false,
    secretSet: false,
    input: { kind: "int", min: 1 },
    description: field,
  }));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createTimingPolicySync", () => {
  it("subscribes once, applies the initial full read, and rereads only for relevant pushes", async () => {
    const next = { ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, interactiveRpcMs: 17_000 };
    const store = createTimingPolicyStore();
    let handler: (change: ConfigChanged) => void = () => undefined;
    let subscribed = false;
    const list = vi.fn(async () => ({ entries: entries(next) }));
    const subscribe = vi.fn(async () => undefined);
    const sync = createTimingPolicySync({
      store,
      list,
      subscribe,
      onConfigChanged: (nextHandler) => {
        handler = nextHandler;
        subscribed = true;
        return () => {
          subscribed = false;
          handler = () => undefined;
        };
      },
      onDiagnostic: vi.fn(),
    });

    sync.start();
    sync.start();
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
    expect(store.current().interactiveRpcMs).toBe(17_000);

    handler({ key: "TAKI_LOG_LEVEL", value: "debug" });
    handler({ key: TIMING_CONFIG_KEYS.chatAckMs, value: 16_000 });
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    sync.dispose();
    expect(subscribed).toBe(false);
  });

  it("keeps last-good policy and emits an actionable diagnostic for an invalid refresh", async () => {
    const store = createTimingPolicyStore();
    const diagnostics: string[] = [];
    const sync = createTimingPolicySync({
      store,
      list: async () => ({ entries: entries({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, homeResultMs: 35_000 }) }),
      subscribe: async () => undefined,
      onConfigChanged: () => () => undefined,
      onDiagnostic: (message) => diagnostics.push(message),
    });
    sync.start();
    await flush();
    expect(store.current()).toEqual(TIMING_POLICY_DEVELOPMENT_DEFAULTS);
    expect(diagnostics.join(" ")).toContain("keeping last-good timing policy");
  });

  it("reconciles missed timing values once after same-client membership recovery without a push", async () => {
    const store = createTimingPolicyStore();
    let recovered: () => void = () => undefined;
    const list = vi.fn().mockResolvedValueOnce({ entries: entries(TIMING_POLICY_DEVELOPMENT_DEFAULTS) })
      .mockResolvedValueOnce({ entries: entries({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, interactiveRpcMs: 19_000 }) });
    const sync = createTimingPolicySync({
      store, list, subscribe: vi.fn(async () => { throw new Error("setup lost"); }),
      onConfigChanged: () => () => undefined,
      onSubscriptionRecovered: (handler) => { recovered = handler; return () => { recovered = () => undefined; }; },
      onDiagnostic: vi.fn(),
    });
    sync.start();
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    recovered();
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    expect(store.current().interactiveRpcMs).toBe(19_000);
    sync.dispose();
    recovered();
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
