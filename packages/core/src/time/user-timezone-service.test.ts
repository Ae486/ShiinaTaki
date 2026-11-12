import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createUserTimezoneRepo } from "../db/user-timezone-repo.ts";
import { createScheduledTaskRepo } from "../db/scheduled-task-repo.ts";
import { createScheduledTaskService } from "../scheduler/scheduled-task-service.ts";
import { createSchedulePatternAdapter } from "../scheduler/schedule-pattern.ts";
import { createUserTimezoneService } from "./user-timezone-service.ts";

const operator = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const authority = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reportSourceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const at = new Date("2026-09-20T00:00:00.000Z");
const dbs: Database[] = [];
const directories: string[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture(path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS }); dbs.push(db);
  const repo = createUserTimezoneRepo(db);
  const tasks = createScheduledTaskRepo(db, () => at.toISOString());
  const schedules = createScheduledTaskService({ repo: tasks, patterns: createSchedulePatternAdapter(), userTimezone: () => repo.read().timezone, now: () => at });
  const onChange = vi.fn();
  const onRevision = vi.fn();
  const service = createUserTimezoneService({ db, repo, schedules, now: () => at,
    isOperatorDevice: (id) => id === authority || id === operator, logger: { warn: vi.fn() }, onEffectiveZoneChange: onChange, onChanged: onRevision });
  return { db, repo, tasks, schedules, service, onChange, onRevision };
}

describe("UserTimezoneService", () => {
  it("invalidates same-zone authority revisions after commit and isolates observer failures", () => {
    const { service, onChange, onRevision } = fixture();
    expect(service.update({ expectedRevision: 1, mode: "fixed", timezone: "UTC" }, operator).status).toBe("accepted");
    expect(onRevision).toHaveBeenCalledTimes(1); expect(onChange).not.toHaveBeenCalled();
    expect(service.update({ expectedRevision: 1, mode: "fixed", timezone: "UTC" }, operator).status).toBe("refused");
    expect(onRevision).toHaveBeenCalledTimes(1);
    onRevision.mockImplementation(() => { throw new Error("observer failed"); });
    expect(service.update({ expectedRevision: 2, mode: "fixed", timezone: "UTC" }, operator).status).toBe("accepted");
    expect(service.read().revision).toBe(3);
  });

  it("persists fixed/follow modes and last confirmation across a real SQLite reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "taki-timezone-")); directories.push(directory);
    const path = join(directory, "core.db");
    const first = fixture(path);
    expect(first.service.read()).toMatchObject({ timezone: "UTC", revision: 1, confirmedAt: null, source: "bootstrap" });
    const fixed = first.service.update({ expectedRevision: 1, mode: "fixed", timezone: "Asia/Tokyo" }, operator);
    expect(fixed).toMatchObject({ status: "accepted", state: { revision: 2, source: "operator", sourceDeviceId: operator } });
    first.db.close();
    const second = fixture(path);
    expect(second.service.read()).toEqual(fixed.state);
    const follow = second.service.update({ expectedRevision: 2, mode: "follow-primary-device", authorityDeviceId: authority }, operator);
    expect(follow.state).toMatchObject({ timezone: "Asia/Tokyo", source: "operator", sourceDeviceId: operator, confirmedAt: at.toISOString() });
    const report = second.service.report({ expectedRevision: 3, timezone: "America/New_York", reportSourceId }, authority);
    expect(report).toMatchObject({ status: "accepted", state: { revision: 4, source: "device", sourceDeviceId: authority } });
    second.db.close();
    const third = fixture(path);
    expect(third.service.read()).toEqual(report.state);
    expect(third.service.timezone()).toBe("America/New_York");
    expect(third.service.dayStart()).toBe("2026-09-19T04:00:00.000Z");
  });

  it("rejects invalid zones, unknown device authority and stale CAS without writes", () => {
    const { service, onChange } = fixture();
    expect(() => service.update({ expectedRevision: 1, mode: "fixed", timezone: "Moon/Base" }, operator)).toThrow();
    expect(service.update({ expectedRevision: 1, mode: "follow-primary-device", authorityDeviceId: reportSourceId }, operator))
      .toMatchObject({ status: "refused", reason: "unknown-authority" });
    service.update({ expectedRevision: 1, mode: "follow-primary-device", authorityDeviceId: authority }, operator);
    expect(service.read()).toMatchObject({ timezone: "UTC", source: "bootstrap", confirmedAt: null });
    expect(service.report({ expectedRevision: 2, timezone: "Asia/Tokyo", reportSourceId }, operator)).toMatchObject({ status: "refused", reason: "foreign-authority" });
    expect(service.report({ expectedRevision: 1, timezone: "Asia/Tokyo", reportSourceId }, authority)).toMatchObject({ status: "refused", reason: "revision-conflict" });
    expect(service.update({ expectedRevision: 1, mode: "fixed", timezone: "Asia/Tokyo" }, operator)).toMatchObject({ status: "refused", reason: "revision-conflict" });
    expect(service.read().revision).toBe(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores device reports in fixed mode and records same-zone confirmation without rearming", () => {
    const { service, onChange } = fixture();
    expect(service.report({ expectedRevision: 1, timezone: "Asia/Tokyo", reportSourceId }, authority)).toMatchObject({ status: "ignored-fixed" });
    expect(service.read().confirmedAt).toBeNull();
    service.update({ expectedRevision: 1, mode: "fixed", timezone: "UTC" }, operator);
    expect(service.read()).toMatchObject({ revision: 2, source: "operator", confirmedAt: at.toISOString() });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rolls back timezone and derived schedules together if recomputation fails", () => {
    const { db, service, schedules, tasks, onChange } = fixture();
    const task = schedules.create({ characterId: "taki", name: "Morning", controlInput: "morning", pattern: { kind: "cron", expression: "0 9 * * *" }, timezone: { kind: "user" } });
    db.exec("CREATE TRIGGER reject_schedule_change BEFORE UPDATE ON scheduled_tasks BEGIN SELECT RAISE(ABORT, 'blocked'); END");
    expect(() => service.update({ expectedRevision: 1, mode: "fixed", timezone: "Asia/Tokyo" }, operator)).toThrow("blocked");
    expect(service.read()).toMatchObject({ timezone: "UTC", revision: 1 });
    expect(tasks.get(task.taskId)).toEqual(task);
    expect(onChange).not.toHaveBeenCalled();
    db.exec("DROP TRIGGER reject_schedule_change");
    expect(service.update({ expectedRevision: 1, mode: "fixed", timezone: "Asia/Tokyo" }, operator).status).toBe("accepted");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("does not lose committed confirmation when a post-commit observer fails", () => {
    const { db, repo, schedules } = fixture();
    const warn = vi.fn();
    const service = createUserTimezoneService({ db, repo, schedules, isOperatorDevice: () => true, logger: { warn },
      onEffectiveZoneChange: () => { throw new Error("observer failed"); }, now: () => at });
    expect(service.update({ expectedRevision: 1, mode: "fixed", timezone: "Asia/Tokyo" }, operator).status).toBe("accepted");
    expect(service.read().timezone).toBe("Asia/Tokyo");
    expect(warn).toHaveBeenCalledOnce();
  });
});
