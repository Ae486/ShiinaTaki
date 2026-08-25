import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createScheduledTaskRepo } from "../db/scheduled-task-repo.ts";
import { createSchedulePatternAdapter } from "./schedule-pattern.ts";
import { createScheduledTaskService } from "./scheduled-task-service.ts";
const dbs: Database[] = []; afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
describe("ScheduledTaskService", () => { it("validates cron and rearms only after commit", () => { const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db); const rearm = vi.fn(); const service = createScheduledTaskService({ repo: createScheduledTaskRepo(db), patterns: createSchedulePatternAdapter(), userTimezone: () => "UTC", now: () => new Date("2026-08-25T00:00:00.000Z"), rearm }); const task = service.create({ characterId: "taki", name: "Hourly", controlInput: "Review status", pattern: { kind: "cron", expression: "0 * * * *" }, timezone: { kind: "user" } }); expect(task.nextRunAt).toBe("2026-08-25T01:00:00.000Z"); expect(rearm).toHaveBeenCalledOnce(); expect(() => service.create({ characterId: "taki", name: "Bad", controlInput: "bad", pattern: { kind: "cron", expression: "nope" }, timezone: { kind: "user" } })).toThrow(); expect(rearm).toHaveBeenCalledOnce(); }); });
