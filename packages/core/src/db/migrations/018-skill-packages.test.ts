import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase, type Database } from "../sqlite.ts";
import { skillPackagesMigration018 } from "./018-skill-packages.ts";
const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
describe("skillPackagesMigration018", () => {
  it("creates the strict table and active-name uniqueness", () => {
    const db = openDatabase({ path: ":memory:", migrations: [] }); dbs.push(db); runMigrations(db, [skillPackagesMigration018]);
    const insert = db.prepare("INSERT INTO skill_packages (package_id,skill_name,description,owner_host_id,content_hash,lifecycle_state,enabled,source_kind,source_locator,trust,scan_version,scan_verdict,scan_findings,failure_reason,config_revision,created_at,updated_at) VALUES (:package_id,:skill_name,:description,:owner_host_id,:content_hash,:lifecycle_state,:enabled,:source_kind,:source_locator,:trust,:scan_version,:scan_verdict,:scan_findings,:failure_reason,:config_revision,:created_at,:updated_at)");
    const row = { package_id: "11111111-1111-4111-8111-111111111111", skill_name: "demo", description: "demo", owner_host_id: "22222222-2222-4222-8222-222222222222", content_hash: null, lifecycle_state: "active", enabled: 1, source_kind: "directory", source_locator: "browser-directory", trust: "operator-local", scan_version: "v1", scan_verdict: "passed", scan_findings: "[]", failure_reason: null, config_revision: 1, created_at: "2026-08-18T00:00:00.000Z", updated_at: "2026-08-18T00:00:00.000Z" };
    expect(() => insert.run(row)).not.toThrow(); expect(() => insert.run({ ...row, package_id: "33333333-3333-4333-8333-333333333333" })).toThrow();
    expect(() => insert.run({ ...row, package_id: "33333333-3333-4333-8333-333333333333", skill_name: null, lifecycle_state: "rejected", enabled: 0 })).not.toThrow();
  });
});
