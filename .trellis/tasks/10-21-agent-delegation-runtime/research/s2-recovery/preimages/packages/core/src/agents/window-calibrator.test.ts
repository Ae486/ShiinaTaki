import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createWindowStateRepo, type WindowStateRepo } from "../db/window-state-repo.ts";
import { createWindowCalibrator, EMA_ALPHA, FACTOR_MAX, FACTOR_MIN, OVERFLOW_RETAIN } from "./window-calibrator.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function makeRepo(): WindowStateRepo {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return createWindowStateRepo(db);
}

const DECLARED = 32768;

describe("createWindowCalibrator (R1 tier 2 + R2 storage)", () => {
  it("starts at declared × factor 1.0 with no persisted state", () => {
    const calibrator = createWindowCalibrator({ repo: makeRepo(), slot: "main", declared: DECLARED });
    expect(calibrator.effectiveWindow()).toBe(DECLARED);
  });

  it("onUsage EMA-updates the factor: an undercounting estimator shrinks the estimator-unit window", () => {
    const calibrator = createWindowCalibrator({ repo: makeRepo(), slot: "main", declared: DECLARED });
    // One sample at ratio 2.0 (provider saw twice our estimate): factor = α·2 + (1-α)·1.
    calibrator.onUsage(2000, 1000);
    const factor = EMA_ALPHA * 2 + (1 - EMA_ALPHA) * 1;
    expect(calibrator.effectiveWindow()).toBe(Math.floor(DECLARED / factor));
  });

  it("an overcounting estimator (ratio < 1) grows the estimator-unit window above declared", () => {
    const calibrator = createWindowCalibrator({ repo: makeRepo(), slot: "main", declared: DECLARED });
    calibrator.onUsage(500, 1000);
    const factor = EMA_ALPHA * 0.5 + (1 - EMA_ALPHA) * 1;
    expect(calibrator.effectiveWindow()).toBe(Math.floor(DECLARED / factor));
  });

  it("clamps the factor to [0.5, 2] so one bad sample cannot halve or double the window", () => {
    const high = createWindowCalibrator({ repo: makeRepo(), slot: "main", declared: DECLARED });
    high.onUsage(1_000_000, 1); // ratio 10^6 -> clamp at 2
    expect(high.effectiveWindow()).toBe(Math.floor(DECLARED / FACTOR_MAX));

    const low = createWindowCalibrator({ repo: makeRepo(), slot: "main", declared: DECLARED });
    for (let i = 0; i < 50; i += 1) low.onUsage(1, 1_000_000); // ratio ~0 -> converge to the floor
    expect(low.effectiveWindow()).toBe(Math.floor(DECLARED / FACTOR_MIN));
  });

  it("ignores non-positive/absent samples (no usage signal beats a garbage one)", () => {
    const calibrator = createWindowCalibrator({ repo: makeRepo(), slot: "main", declared: DECLARED });
    calibrator.onUsage(0, 1000);
    calibrator.onUsage(1000, 0);
    calibrator.onUsage(Number.NaN, 1000);
    expect(calibrator.effectiveWindow()).toBe(DECLARED);
  });

  it("onOverflow shrinks to floor(observed × 0.9), persists, and returns the new real window (R2)", () => {
    const repo = makeRepo();
    const calibrator = createWindowCalibrator({ repo, slot: "main", declared: DECLARED });

    expect(calibrator.onOverflow(30000)).toBe(Math.floor(30000 * OVERFLOW_RETAIN));
    expect(calibrator.effectiveWindow()).toBe(Math.floor(30000 * OVERFLOW_RETAIN)); // factor still 1
    expect(repo.get("main")).toEqual({ effectiveWindow: 27000, factor: 1 });
  });

  it("onOverflow never raises the window above declared", () => {
    const calibrator = createWindowCalibrator({ repo: makeRepo(), slot: "main", declared: DECLARED });
    expect(calibrator.onOverflow(DECLARED * 10)).toBe(DECLARED);
  });

  it("onOverflow ignores a garbage observation and reports the current window", () => {
    const calibrator = createWindowCalibrator({ repo: makeRepo(), slot: "main", declared: DECLARED });
    expect(calibrator.onOverflow(0)).toBe(DECLARED);
    expect(calibrator.onOverflow(Number.NaN)).toBe(DECLARED);
  });

  it("persists across re-creation: the shrunk window and the learned factor survive a restart", () => {
    const repo = makeRepo();
    const first = createWindowCalibrator({ repo, slot: "main", declared: DECLARED });
    first.onOverflow(30000);
    first.onUsage(2000, 1000);

    const second = createWindowCalibrator({ repo, slot: "main", declared: DECLARED });
    expect(second.effectiveWindow()).toBe(first.effectiveWindow());
  });

  it("persists a lowered declaration so runtime and operator status agree after restart", () => {
    const repo = makeRepo();
    repo.set("main", { effectiveWindow: 131072, factor: 1 });

    const calibrator = createWindowCalibrator({ repo, slot: "main", declared: 131000 });

    expect(calibrator.effectiveWindow()).toBe(131000);
    expect(repo.get("main")).toEqual({ effectiveWindow: 131000, factor: 1 });
    expect(repo.list()).toEqual([
      expect.objectContaining({ slot: "main", effectiveWindow: 131000, factor: 1 }),
    ]);
  });

  it("preserves the learned correction factor when persisting a lowered declaration", () => {
    const repo = makeRepo();
    repo.set("main", { effectiveWindow: 131072, factor: 1.25 });

    const calibrator = createWindowCalibrator({ repo, slot: "main", declared: 131000 });

    expect(calibrator.effectiveWindow()).toBe(Math.floor(131000 / 1.25));
    expect(repo.get("main")).toEqual({ effectiveWindow: 131000, factor: 1.25 });
  });

  it("keeps slots independent through the repo key", () => {
    const repo = makeRepo();
    const main = createWindowCalibrator({ repo, slot: "main", declared: DECLARED });
    main.onOverflow(10000);
    const vision = createWindowCalibrator({ repo, slot: "vision", declared: DECLARED });
    expect(vision.effectiveWindow()).toBe(DECLARED);
  });
});
