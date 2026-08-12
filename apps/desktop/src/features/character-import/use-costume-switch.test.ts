import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIMING_POLICY_DEVELOPMENT_DEFAULTS } from "@taki/shared";

vi.mock("@/lib/character-asset-url.js", () => ({
  costumeAssetResolver: vi.fn(async (input: { costume: string }) => ({
    settingsUrl: `asset://${input.costume}/model.json`,
    costumeId: input.costume,
    resolve: () => null,
  })),
}));

import { runGuardedSwitch, type SwitchGuard, type SwitchSink } from "./use-costume-switch.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("manual costume single-flight release", () => {
  it("accepts a later switch while the prior committed report is still pending", async () => {
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn() });
    const firstReport = deferred<void>();
    const reportAvatar = vi
      .fn()
      .mockImplementationOnce(() => firstReport.promise)
      .mockResolvedValueOnce(undefined);
    const client = {
      currentTimingPolicy: () => ({
        ...TIMING_POLICY_DEVELOPMENT_DEFAULTS,
        petCostumeTotalMs: 100,
        rendererLoadMs: 50,
      }),
      costumeResolution: vi.fn(async () => ({ resolution: {} })),
      reportAvatar,
    };
    const scene = {
      switchCostume: vi.fn(async () => ({ motions: ["idle"], expressions: [] })),
      abortSwitch: vi.fn(),
    };
    const guard: SwitchGuard = {
      current: { id: null, gen: 0, attempt: null, client: null, scene: null },
    };
    const switching: Array<string | null> = [];
    let successes = 0;
    const sink: SwitchSink = {
      setSwitchingId: (id) => switching.push(id),
      setError: vi.fn(),
      onSuccess: () => (successes += 1),
    };

    const first = runGuardedSwitch(
      { client: client as never, scene: scene as never, costume: "arbeit", settingsFile: "model.json" },
      guard,
      sink,
    );
    await flush();
    expect(successes).toBe(1);
    expect(guard.current.id).toBeNull();

    const second = runGuardedSwitch(
      { client: client as never, scene: scene as never, costume: "live_01", settingsFile: "live.model3.json" },
      guard,
      sink,
    );
    await second;

    expect(scene.switchCostume).toHaveBeenCalledTimes(2);
    expect(successes).toBe(2);
    expect(switching).toEqual(["arbeit", null, "live_01", null]);
    expect(guard.current.id).toBeNull();

    firstReport.resolve();
    await first;
  });
});
