import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIMING_POLICY_DEVELOPMENT_DEFAULTS, type TimingPolicy, type CharacterCostumesResult } from "@taki/shared";
import { createCostumeReportSyncTracker } from "./costume-report-sync.ts";
import {
  CostumeAttemptStoppedError,
  startCostumeSwitchAttempt,
  type CostumeSwitchAttemptDeps,
} from "./costume-switch-attempt.ts";

const COSTUMES: CharacterCostumesResult = {
  costumes: ["arbeit"], defaultCostume: "arbeit", settingsFilesByCostume: { arbeit: "model.json" },
};

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

function policy(overrides: Partial<TimingPolicy> = {}): TimingPolicy {
  return { ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, ...overrides };
}

function harness(overrides: Partial<CostumeSwitchAttemptDeps> = {}) {
  const defaultClient = {
    characterCostumes: vi.fn(async () => COSTUMES),
    currentTimingPolicy: vi.fn(() => policy({ petCostumeTotalMs: 40, rendererLoadMs: 30 })),
    costumeResolution: vi.fn(async () => ({ resolution: {} })),
    reportAvatar: vi.fn(async () => undefined),
  };
  const defaultScene = {
    switchCostume: vi.fn(async () => ({ motions: ["wave"], expressions: ["smile"] })),
    abortSwitch: vi.fn(),
  };
  const client = overrides.client ?? defaultClient;
  const scene = overrides.scene ?? defaultScene;
  const onCommit = overrides.onCommit ?? vi.fn();
  const resolveAsset = overrides.resolveAsset ?? vi.fn(async () => ({
    settingsUrl: "asset://characters/taki/arbeit/model.json",
    costumeId: "arbeit",
    resolve: () => null,
  }));
  const reportSync = overrides.reportSync ?? createCostumeReportSyncTracker();
  const deps: CostumeSwitchAttemptDeps = {
    costume: "arbeit",
    ...overrides,
    client,
    scene,
    onCommit,
    resolveAsset,
    reportSync,
  };
  return {
    deps,
    client,
    scene,
    currentTimingPolicy: client.currentTimingPolicy,
    costumeResolution: client.costumeResolution,
    reportAvatar: client.reportAvatar,
    switchCostume: scene.switchCostume,
    abortSwitch: scene.abortSwitch,
    onCommit,
    resolveAsset,
    reportSync,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => vi.useRealTimers());

describe("current-attempt costume metadata", () => {
  it("uses a newly imported or reimported manifest without a Pet metadata reload", async () => {
    const h = harness();
    vi.mocked(h.client.characterCostumes).mockResolvedValue({ ...COSTUMES,
      settingsFilesByCostume: { arbeit: "fresh.model3.json" } });
    await startCostumeSwitchAttempt(h.deps).result;
    expect(h.resolveAsset).toHaveBeenCalledWith(expect.objectContaining({ settingsFile: "fresh.model3.json" }));
    expect(h.client.characterCostumes).toHaveBeenCalledExactlyOnceWith("taki");
  });

  it.each(["cancelled", "superseded", "deadline"] as const)("blocks late metadata after %s", async (reason) => {
    const pending = deferred<CharacterCostumesResult>();
    const h = harness();
    vi.mocked(h.client.characterCostumes).mockReturnValue(pending.promise);
    const attempt = startCostumeSwitchAttempt(h.deps);
    const rejected = expect(attempt.result).rejects.toMatchObject({ reason });
    if (reason === "deadline") await vi.advanceTimersByTimeAsync(40);
    else attempt.cancel(reason);
    await rejected;
    pending.resolve(COSTUMES);
    await flush();
    expect(h.costumeResolution).not.toHaveBeenCalled();
    expect(h.resolveAsset).not.toHaveBeenCalled();
    expect(h.switchCostume).not.toHaveBeenCalled();
    expect(h.reportAvatar).not.toHaveBeenCalled();
  });

  it("distinguishes fresh unknown/unrenderable metadata from a failed read", async () => {
    const h = harness();
    const read = vi.mocked(h.client.characterCostumes);
    read.mockResolvedValueOnce({ costumes: [], defaultCostume: "", settingsFilesByCostume: {} });
    await expect(startCostumeSwitchAttempt(h.deps).result).rejects.toThrow("unknown-costume");
    read.mockResolvedValueOnce({ ...COSTUMES, availability: { arbeit: { renderable: false, missingMotions: 0, missingPacks: [] } } });
    await expect(startCostumeSwitchAttempt(h.deps).result).rejects.toThrow("not-renderable");
    read.mockRejectedValueOnce(new Error("metadata read unavailable"));
    await expect(startCostumeSwitchAttempt(h.deps).result).rejects.toThrow("metadata read unavailable");
    expect(h.costumeResolution).not.toHaveBeenCalled();
    expect(h.switchCostume).not.toHaveBeenCalled();
  });
});

describe("whole costume-attempt deadline and cancellation", () => {
  it("times out unresolved resolution and prevents every later side effect", async () => {
    const resolution = deferred<{ resolution: Record<string, string | null> }>();
    const h = harness({
      client: {
        characterCostumes: async () => COSTUMES,
        currentTimingPolicy: () => policy({ petCostumeTotalMs: 10, rendererLoadMs: 5 }),
        costumeResolution: () => resolution.promise,
        reportAvatar: vi.fn(),
      },
    });
    const attempt = startCostumeSwitchAttempt(h.deps);
    const rejected = expect(attempt.result).rejects.toMatchObject({ reason: "deadline" });

    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    resolution.resolve({ resolution: {} });
    await flush();

    expect(h.resolveAsset).not.toHaveBeenCalled();
    expect(h.switchCostume).not.toHaveBeenCalled();
    expect(h.reportAvatar).not.toHaveBeenCalled();
    expect(h.onCommit).not.toHaveBeenCalled();
  });

  it("refuses the next stage when the clock elapsed even if the scheduler callback is delayed", async () => {
    let now = 0;
    const delayedDeadline = vi.fn();
    const resolution = deferred<{ resolution: Record<string, string | null> }>();
    const h = harness({
      client: {
        characterCostumes: async () => COSTUMES,
        currentTimingPolicy: () => policy({ petCostumeTotalMs: 10, rendererLoadMs: 5 }),
        costumeResolution: () => resolution.promise,
        reportAvatar: vi.fn(),
      },
      runtime: {
        now: () => now,
        schedule: (_delayMs, handler) => {
          delayedDeadline.mockImplementation(handler);
          return { cancel: vi.fn() };
        },
      },
    });
    const attempt = startCostumeSwitchAttempt(h.deps);
    const rejected = expect(attempt.result).rejects.toMatchObject({ reason: "deadline" });

    now = 10;
    resolution.resolve({ resolution: {} });
    await rejected;

    expect(delayedDeadline).not.toHaveBeenCalled();
    expect(h.resolveAsset).not.toHaveBeenCalled();
    expect(h.switchCostume).not.toHaveBeenCalled();
    expect(h.reportAvatar).not.toHaveBeenCalled();
    expect(h.abortSwitch).not.toHaveBeenCalled();
  });

  it("cancels an unresolved Tauri composition and blocks a late continuation", async () => {
    const asset = deferred<Awaited<ReturnType<NonNullable<CostumeSwitchAttemptDeps["resolveAsset"]>>>>();
    const h = harness({ resolveAsset: () => asset.promise });
    const attempt = startCostumeSwitchAttempt(h.deps);
    const rejected = expect(attempt.result).rejects.toMatchObject({ reason: "cancelled" });
    await flush();

    expect(attempt.cancel()).toBe(true);
    await rejected;
    asset.resolve({ settingsUrl: "asset://late", costumeId: "arbeit", resolve: () => null });
    await flush();

    expect(h.switchCostume).not.toHaveBeenCalled();
    expect(h.reportAvatar).not.toHaveBeenCalled();
    expect(h.onCommit).not.toHaveBeenCalled();
  });

  it("settles a Cancel/deadline race once and keeps the first terminal reason", async () => {
    const resolution = deferred<{ resolution: Record<string, string | null> }>();
    const h = harness({
      client: {
        characterCostumes: async () => COSTUMES,
        currentTimingPolicy: () => policy({ petCostumeTotalMs: 10, rendererLoadMs: 5 }),
        costumeResolution: () => resolution.promise,
        reportAvatar: vi.fn(),
      },
    });
    const attempt = startCostumeSwitchAttempt(h.deps);
    let settlements = 0;
    const settled = attempt.result.catch((cause: unknown) => {
      settlements += 1;
      throw cause;
    });
    const rejected = expect(settled).rejects.toEqual(expect.objectContaining({ reason: "cancelled" }));

    await vi.advanceTimersByTimeAsync(9);
    expect(attempt.cancel()).toBe(true);
    expect(attempt.cancel()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(settlements).toBe(1);
  });
});

describe("renderer commit and report synchronization", () => {
  it("invalidates a timed-out renderer ticket and ignores its late completion", async () => {
    const renderer = deferred<{ motions: string[]; expressions: string[] }>();
    const abortSwitch = vi.fn();
    const h = harness({
      client: {
        characterCostumes: async () => COSTUMES,
        currentTimingPolicy: () => policy({ petCostumeTotalMs: 40, rendererLoadMs: 10 }),
        costumeResolution: async () => ({ resolution: {} }),
        reportAvatar: vi.fn(),
      },
      scene: { switchCostume: vi.fn(() => renderer.promise), abortSwitch },
    });
    const attempt = startCostumeSwitchAttempt(h.deps);
    const rejected = expect(attempt.result).rejects.toThrow(/timed out/);
    await flush();
    await vi.advanceTimersByTimeAsync(10);
    await rejected;

    expect(h.abortSwitch).toHaveBeenCalledTimes(1);
    renderer.resolve({ motions: ["late"], expressions: [] });
    await flush();
    expect(h.onCommit).not.toHaveBeenCalled();
    expect(h.reportAvatar).not.toHaveBeenCalled();
  });

  it("commits and releases presentation truth before a failed report becomes recovery-needed", async () => {
    const reportAvatar = vi.fn(async () => Promise.reject(new Error("report unavailable")));
    const h = harness({
      client: {
        characterCostumes: async () => COSTUMES,
        currentTimingPolicy: () => policy({ petCostumeTotalMs: 40, rendererLoadMs: 30 }),
        costumeResolution: async () => ({ resolution: {} }),
        reportAvatar,
      },
    });
    const attempt = startCostumeSwitchAttempt(h.deps);

    await expect(attempt.result).resolves.toEqual({ committed: true, report: "recovery-needed" });
    expect(h.onCommit).toHaveBeenCalledWith({
      costumeId: "arbeit",
      vocabulary: { motions: ["wave"], expressions: ["smile"] },
    });
    expect(attempt.committed()).toBe(true);
    expect(attempt.cancel()).toBe(false);
    expect(h.reportSync.snapshot()).toEqual({
      kind: "recovery-needed",
      costumeId: "arbeit",
      source: "switch",
      message: "report unavailable",
    });
    expect(h.abortSwitch).not.toHaveBeenCalled();
  });

  it("captures the live total/renderer policy once when the attempt begins", async () => {
    let current = policy({ petCostumeTotalMs: 100, rendererLoadMs: 50 });
    const currentTimingPolicy = vi.fn(() => current);
    const resolution = deferred<{ resolution: Record<string, string | null> }>();
    const h = harness({
      client: {
        characterCostumes: async () => COSTUMES,
        currentTimingPolicy,
        costumeResolution: () => resolution.promise,
        reportAvatar: async () => undefined,
      },
    });
    const attempt = startCostumeSwitchAttempt(h.deps);
    current = policy({ petCostumeTotalMs: 1, rendererLoadMs: 1 });
    await vi.advanceTimersByTimeAsync(2);
    resolution.resolve({ resolution: {} });

    await expect(attempt.result).resolves.toEqual({ committed: true, report: "synced" });
    expect(currentTimingPolicy).toHaveBeenCalledTimes(1);
  });

  it("keeps an attached costume successful when the remaining total budget expires during report", async () => {
    const report = deferred<void>();
    const h = harness({
      client: {
        characterCostumes: async () => COSTUMES,
        currentTimingPolicy: () => policy({ petCostumeTotalMs: 10, rendererLoadMs: 5 }),
        costumeResolution: async () => ({ resolution: {} }),
        reportAvatar: () => report.promise,
      },
    });
    const attempt = startCostumeSwitchAttempt(h.deps);
    await flush();
    expect(h.onCommit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    await expect(attempt.result).resolves.toEqual({ committed: true, report: "recovery-needed" });
    expect(h.abortSwitch).not.toHaveBeenCalled();
    expect(h.reportSync.snapshot()).toMatchObject({ kind: "recovery-needed", costumeId: "arbeit" });
  });

  it("commits a renderer result that wins at the exact deadline before a delayed scheduler callback", async () => {
    let now = 0;
    let fireDeadline: () => void = () => undefined;
    const renderer = deferred<{ motions: string[]; expressions: string[] }>();
    const reportAvatar = vi.fn(async () => undefined);
    const h = harness({
      client: {
        characterCostumes: async () => COSTUMES,
        currentTimingPolicy: () => policy({ petCostumeTotalMs: 10, rendererLoadMs: 10 }),
        costumeResolution: async () => ({ resolution: {} }),
        reportAvatar,
      },
      scene: { switchCostume: vi.fn(() => renderer.promise), abortSwitch: vi.fn() },
      runtime: {
        now: () => now,
        schedule: (_delayMs, handler) => {
          fireDeadline = handler;
          return { cancel: vi.fn() };
        },
      },
    });
    const attempt = startCostumeSwitchAttempt(h.deps);
    await flush();

    now = 10;
    renderer.resolve({ motions: ["boundary"], expressions: [] });

    await expect(attempt.result).resolves.toEqual({ committed: true, report: "recovery-needed" });
    expect(h.onCommit).toHaveBeenCalledWith({
      costumeId: "arbeit",
      vocabulary: { motions: ["boundary"], expressions: [] },
    });
    expect(attempt.committed()).toBe(true);
    expect(reportAvatar).not.toHaveBeenCalled();
    expect(h.abortSwitch).not.toHaveBeenCalled();

    fireDeadline();
    expect(h.abortSwitch).not.toHaveBeenCalled();
  });

  it("invalidates a renderer when the total-deadline signal wins before attachment", async () => {
    let now = 0;
    let fireDeadline: () => void = () => undefined;
    const renderer = deferred<{ motions: string[]; expressions: string[] }>();
    const abortSwitch = vi.fn();
    const h = harness({
      client: {
        characterCostumes: async () => COSTUMES,
        currentTimingPolicy: () => policy({ petCostumeTotalMs: 10, rendererLoadMs: 10 }),
        costumeResolution: async () => ({ resolution: {} }),
        reportAvatar: vi.fn(),
      },
      scene: { switchCostume: vi.fn(() => renderer.promise), abortSwitch },
      runtime: {
        now: () => now,
        schedule: (_delayMs, handler) => {
          fireDeadline = handler;
          return { cancel: vi.fn() };
        },
      },
    });
    const attempt = startCostumeSwitchAttempt(h.deps);
    const rejected = expect(attempt.result).rejects.toMatchObject({ reason: "deadline" });
    await flush();

    now = 10;
    fireDeadline();
    await rejected;
    expect(abortSwitch).toHaveBeenCalledTimes(1);

    renderer.resolve({ motions: ["late"], expressions: [] });
    await flush();
    expect(h.onCommit).not.toHaveBeenCalled();
    expect(h.reportAvatar).not.toHaveBeenCalled();
  });

  it("accepts a report acknowledgement that wins before a delayed deadline callback", async () => {
    let now = 0;
    let fireDeadline: () => void = () => undefined;
    const report = deferred<void>();
    const h = harness({
      client: {
        characterCostumes: async () => COSTUMES,
        currentTimingPolicy: () => policy({ petCostumeTotalMs: 10, rendererLoadMs: 5 }),
        costumeResolution: async () => ({ resolution: {} }),
        reportAvatar: vi.fn(() => report.promise),
      },
      runtime: {
        now: () => now,
        schedule: (_delayMs, handler) => {
          fireDeadline = handler;
          return { cancel: vi.fn() };
        },
      },
    });
    const attempt = startCostumeSwitchAttempt(h.deps);
    await flush();
    expect(h.onCommit).toHaveBeenCalledTimes(1);

    now = 10;
    report.resolve();
    await expect(attempt.result).resolves.toEqual({ committed: true, report: "synced" });
    expect(h.reportSync.snapshot()).toEqual({ kind: "synced", costumeId: "arbeit", source: "switch" });

    fireDeadline();
    expect(h.reportSync.snapshot()).toEqual({ kind: "synced", costumeId: "arbeit", source: "switch" });
  });

  it("uses a typed interruption error for deterministic caller classification", () => {
    expect(new CostumeAttemptStoppedError("superseded", "stale")).toMatchObject({
      name: "CostumeAttemptStoppedError",
      reason: "superseded",
      message: "stale",
    });
  });
});
