import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createUserTimezoneRepo } from "../db/user-timezone-repo.ts";
import { createScheduledTaskRepo } from "../db/scheduled-task-repo.ts";
import { createScheduledTaskService } from "../scheduler/scheduled-task-service.ts";
import { createSchedulePatternAdapter } from "../scheduler/schedule-pattern.ts";
import { createScheduleEngine } from "../scheduler/schedule-engine.ts";
import { createUserTimezoneService } from "./user-timezone-service.ts";

const operator = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function fixture(at = "2026-09-20T02:00:00.000Z") {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const repo = createUserTimezoneRepo(db); const tasks = createScheduledTaskRepo(db, () => at);
  const patterns = createSchedulePatternAdapter(); const now = () => new Date(at);
  const schedules = createScheduledTaskService({ repo: tasks, patterns, userTimezone: () => repo.read().timezone, now });
  const rearm = vi.fn();
  const service = createUserTimezoneService({ db, repo, schedules, now, isOperatorDevice: () => true,
    logger: { warn: vi.fn() }, onEffectiveZoneChange: rearm });
  return { db, repo, tasks, patterns, schedules, service, rearm, now };
}

describe("User Timezone schedule integration", () => {
  it("recomputes only future user-zone cron while preserving pinned and absolute definitions", () => {
    const f = fixture();
    const create = { characterId: "taki", name: "Morning", controlInput: "morning" };
    const user = f.schedules.create({ ...create, pattern: { kind: "cron", expression: "0 9 * * *" }, timezone: { kind: "user" } });
    const pinned = f.schedules.create({ ...create, pattern: { kind: "cron", expression: "0 9 * * *" }, timezone: { kind: "fixed", timezone: "America/New_York" } });
    const absolute = f.schedules.create({ ...create, pattern: { kind: "at", at: "2026-09-20T10:00:00.000Z" }, timezone: { kind: "user" } });
    const every = f.schedules.create({ ...create, pattern: { kind: "every", everyMs: 60_000, anchorAt: "2026-09-20T03:00:00.000Z" }, timezone: { kind: "user" } });
    const paused = f.schedules.create({ ...create, pattern: { kind: "cron", expression: "0 10 * * *" }, timezone: { kind: "user" } });
    const pausedBefore = f.schedules.pause(paused.taskId, paused.revision);
    f.service.update({ expectedRevision: 1, mode: "fixed", timezone: "Asia/Tokyo" }, operator);
    expect(f.tasks.get(user.taskId)).toMatchObject({ nextRunAt: "2026-09-21T00:00:00.000Z", revision: user.revision, pattern: user.pattern });
    for (const stable of [pinned, absolute, every, pausedBefore]) expect(f.tasks.get(stable.taskId)).toEqual(stable);
    expect(f.tasks.due(f.now().toISOString())).toEqual([]);
    expect(f.tasks.unsettled()).toEqual([]);
    expect(f.rearm).toHaveBeenCalledOnce();
    expect(f.service.dayStart()).toBe("2026-09-19T15:00:00.000Z");
    f.service.update({ expectedRevision: 2, mode: "follow-primary-device", authorityDeviceId: operator }, operator);
    f.service.report({ expectedRevision: 3, timezone: "America/New_York", reportSourceId: operator }, operator);
    expect(f.tasks.get(user.taskId)?.nextRunAt).toBe("2026-09-20T13:00:00.000Z");
    expect(f.rearm).toHaveBeenCalledTimes(2);
  });

  it("does not replay historical slots or rewrite an already claimed occurrence", () => {
    const f = fixture();
    const task = f.tasks.create({ characterId: "taki", name: "Morning", controlInput: "morning",
      pattern: { kind: "cron", expression: "0 9 * * *" }, timezone: { kind: "user" }, nextRunAt: "2026-09-19T09:00:00.000Z" });
    const occurrence = f.tasks.claimOccurrence({ taskId: task.taskId, characterId: task.characterId,
      scheduledFor: task.nextRunAt!, taskRevision: task.revision, controlInput: task.controlInput,
      firedAt: "2026-09-19T09:00:00.000Z", late: false });
    f.service.update({ expectedRevision: 1, mode: "fixed", timezone: "Asia/Tokyo" }, operator);
    expect(f.tasks.get(task.taskId)?.nextRunAt).toBe("2026-09-21T00:00:00.000Z");
    expect(f.tasks.unsettled()).toEqual([occurrence]);
  });

  it("rechecks a captured due row after an in-flight dispatch crosses a timezone update", async () => {
    const f = fixture("2026-09-20T09:00:00.000Z");
    const first = f.tasks.create({ characterId: "taki", name: "First", controlInput: "first", pattern: { kind: "at", at: "2026-09-20T08:59:59.000Z" }, timezone: { kind: "user" }, nextRunAt: "2026-09-20T08:59:59.000Z" });
    const future = f.tasks.create({ characterId: "taki", name: "Second", controlInput: "second", pattern: { kind: "cron", expression: "0 9 * * *" }, timezone: { kind: "user" }, nextRunAt: "2026-09-20T09:00:00.000Z" });
    let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
    const dispatch = vi.fn(async () => { await blocked; return "run"; });
    const timer = vi.fn(() => ({}));
    const engine = createScheduleEngine({ repo: f.tasks, patterns: f.patterns, runs: { dispatch, reconcile: vi.fn() },
      userTimezone: f.service.timezone, logger: { error: vi.fn() } as never, now: f.now, setTimer: timer, clearTimer: vi.fn() });
    f.rearm.mockImplementation(() => engine.rearm());
    const started = engine.start();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    f.service.update({ expectedRevision: 1, mode: "fixed", timezone: "Asia/Tokyo" }, operator);
    expect(f.tasks.get(future.taskId)?.nextRunAt).toBe("2026-09-21T00:00:00.000Z");
    release(); await started; await engine.stop();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(first.taskId, expect.any(Object));
    expect(f.tasks.unsettled().map((entry) => entry.taskId)).toEqual([first.taskId]);
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 1_000);
  });
});
