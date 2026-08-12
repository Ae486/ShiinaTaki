import { describe, expect, it, vi } from "vitest";
import type { CharacterCostumesResult } from "@taki/shared";
import type { CostumeAttemptHandle } from "@/lib/costume-switch-attempt.js";
import {
  createInitialPromotionController,
  type InitialPromotionControllerDeps,
  type InitialPromotionController,
} from "./initial-costume-promotion.ts";

type PromotionClient = Parameters<InitialPromotionController["start"]>[0];
type PromotionScene = Parameters<InitialPromotionController["start"]>[1];

const COSTUMES: CharacterCostumesResult = {
  costumes: ["arbeit", "live_01"],
  defaultCostume: "arbeit",
  settingsFilesByCostume: { arbeit: "model.json", live_01: "live.model3.json" },
};

const SCENE = { switchCostume: vi.fn(), abortSwitch: vi.fn() } as unknown as PromotionScene;

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function client(load: () => Promise<CharacterCostumesResult>): PromotionClient {
  return {
    characterCostumes: load,
    costumeResolution: vi.fn(),
    reportAvatar: vi.fn(),
    currentTimingPolicy: vi.fn(),
  } as unknown as PromotionClient;
}

function resolvedAttempt(onCommit: () => void): CostumeAttemptHandle {
  onCommit();
  return { result: Promise.resolve({ committed: true, report: "synced" }), cancel: () => false, committed: () => true };
}

function controller(startAttempt: InitialPromotionControllerDeps["startAttempt"]) {
  const onCommit = vi.fn();
  const onDiagnostic = vi.fn();
  return {
    value: createInitialPromotionController({
      characterId: "taki",
      pickCostume: () => "arbeit",
      startAttempt,
      onCommit,
      onDiagnostic,
    }),
    onCommit,
    onDiagnostic,
  };
}

describe("initial costume promotion recovery", () => {
  it("ignores an interrupted metadata result and lets the replacement generation promote", async () => {
    let resolveFirst!: (value: CharacterCostumesResult) => void;
    const firstResult = new Promise<CharacterCostumesResult>((resolve) => (resolveFirst = resolve));
    const startAttempt = vi.fn((input) => resolvedAttempt(() => input.onCommit({ costumeId: "arbeit", vocabulary: { motions: [], expressions: [] } })));
    const h = controller(startAttempt);
    const first = h.value.start(client(() => firstResult), SCENE);

    h.value.interrupt();
    await h.value.start(client(async () => COSTUMES), SCENE);
    resolveFirst(COSTUMES);
    await first;

    expect(startAttempt).toHaveBeenCalledTimes(1);
    expect(h.value.phase()).toBe("committed");
    expect(h.onCommit).toHaveBeenCalledTimes(1);
  });

  it("latches at attachment and does not repeat while report synchronization is still pending", async () => {
    let finishReport!: () => void;
    const reportResult = new Promise<void>((resolve) => (finishReport = resolve));
    const load = vi.fn(async () => COSTUMES);
    const startAttempt = vi.fn((input) => {
      input.onCommit({ costumeId: "arbeit", vocabulary: { motions: ["idle"], expressions: [] } });
      return {
        result: reportResult.then(() => ({ committed: true as const, report: "synced" as const })),
        cancel: () => false,
        committed: () => true,
      };
    });
    const h = controller(startAttempt);
    const first = h.value.start(client(load), SCENE);
    await flush();

    expect(h.value.phase()).toBe("committed");
    await h.value.start(client(load), SCENE);
    expect(load).toHaveBeenCalledTimes(1);
    expect(startAttempt).toHaveBeenCalledTimes(1);

    finishReport();
    await first;
    expect(h.value.phase()).toBe("committed");
  });

  it("cancels an interrupted pre-commit attempt and accepts a later generation", async () => {
    let rejectFirst!: (cause: unknown) => void;
    const firstResult = new Promise<never>((_resolve, reject) => (rejectFirst = reject));
    const cancelFirst = vi.fn(() => {
      rejectFirst(new Error("superseded"));
      return true;
    });
    const startAttempt = vi
      .fn()
      .mockImplementationOnce(() => ({ result: firstResult, cancel: cancelFirst, committed: () => false }))
      .mockImplementationOnce((input) =>
        resolvedAttempt(() => input.onCommit({ costumeId: "arbeit", vocabulary: { motions: [], expressions: [] } })),
      );
    const h = controller(startAttempt);
    const first = h.value.start(client(async () => COSTUMES), SCENE);
    await flush();

    h.value.interrupt();
    await h.value.start(client(async () => COSTUMES), SCENE);
    await first;

    expect(cancelFirst).toHaveBeenCalledTimes(1);
    expect(startAttempt).toHaveBeenCalledTimes(2);
    expect(h.value.phase()).toBe("committed");
  });
});
