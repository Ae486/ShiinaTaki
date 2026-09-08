/**
 * INPUT:  perception.card / pause-state fixtures and a fixed local clock (no DOM, no socket).
 * OUTPUT: assertions for the pause wording, the sampling/activity mapping and the local-midnight deadline.
 * POS:    unit test for windows/home/pages/perception/perception-view. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import type { PerceptionCard } from "@taki/shared";
import { activityRows, midnightAfter, pauseLabel, samplingRows } from "./perception-view.ts";

const CARD: PerceptionCard = {
  current: { processName: "Code.exe", windowTitle: "main.ts", startedAt: 1, durationMs: 300_000, samples: 5, idle: false },
  recent: [{ processName: "idle", windowTitle: "", startedAt: 1, durationMs: 600_000, samples: 10, idle: true }],
  samplingStatus: { foreground: true, ambientScreen: false },
  pauseState: { paused: false, until: null },
};

describe("perception view models", () => {
  it("words each pause state distinctly", () => {
    expect(pauseLabel({ paused: false, until: null })).toBe("未启用隐私暂停");
    expect(pauseLabel({ paused: true, until: null })).toContain("手动恢复");
    expect(pauseLabel({ paused: true, until: Date.now() + 3_600_000 })).toContain("已暂停至");
  });

  it("reports each sampler's status separately", () => {
    expect(samplingRows(CARD)).toEqual([
      { label: "前台活动采样调度", value: "已安排" },
      { label: "环境截屏采样调度", value: "未安排" },
    ]);
  });

  it("lists the current stretch first, then the recent ones, marking idle", () => {
    const rows = activityRows(CARD);

    expect(rows[0]?.label).toBe("最新采样");
    expect(rows[0]?.value).toContain("Code.exe · main.ts");
    expect(rows[1]?.value).toContain("空闲");
  });

  it("renders an empty card as no rows rather than placeholder activity", () => {
    expect(activityRows({ ...CARD, current: null, recent: [] })).toEqual([]);
  });

  it("computes the next LOCAL midnight for the pause-until-tomorrow shortcut", () => {
    const now = new Date(2026, 7, 3, 22, 15, 30);

    const deadline = new Date(midnightAfter(now));

    expect(deadline.getDate()).toBe(4);
    expect([deadline.getHours(), deadline.getMinutes()]).toEqual([0, 0]);
    expect(deadline.getTime()).toBeGreaterThan(now.getTime());
  });
});
