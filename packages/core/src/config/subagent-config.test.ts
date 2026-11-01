import { afterEach, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createConfigSource } from "./config-source.ts";
import { readSubagentCheckInPolicy } from "./subagent-config.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
it("validates live registry policy with stored and environment precedence and truthful apply metadata", () => {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const repo = createConfigRepo(db); const source = createConfigSource({ repo, env: {} });
  expect(readSubagentCheckInPolicy(source)).toEqual({ steps: 50, parentApprovals: 3 });
  repo.upsert("TAKI_SUBAGENT_CHECKIN_STEPS", 70); repo.upsert("TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS", 0);
  expect(readSubagentCheckInPolicy(source)).toEqual({ steps: 70, parentApprovals: 0 });
  const env = createConfigSource({ repo, env: { TAKI_SUBAGENT_CHECKIN_STEPS: "5" } });
  expect(readSubagentCheckInPolicy(env)).toEqual({ steps: 5, parentApprovals: 0 });
  expect(source.effectiveAll().find((row) => row.key === "TAKI_SUBAGENT_CHECKIN_STEPS")).toMatchObject({ apply: "live", description: expect.stringContaining("next") });
  expect(() => readSubagentCheckInPolicy(createConfigSource({ repo, env: { TAKI_SUBAGENT_CHECKIN_STEPS: "0" } }))).toThrow();
});
