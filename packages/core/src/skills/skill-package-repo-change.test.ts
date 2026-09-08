import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database, type SqlStatement } from "../db/sqlite.ts";
import { createSkillPackageRepo } from "./skill-package-repo.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const input = { skillName: "demo", description: "demo", ownerHostId: OWNER, contentHash: `sha256.${"a".repeat(64)}`, lifecycleState: "active" as const, enabled: true, sourceKind: "directory" as const, sourceLocator: "browser-directory", trust: "operator-local" as const, scanVersion: "v1", scanVerdict: "passed" as const, scanFindings: [], failureReason: null };
const databases: Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  let readBack: SqlStatement | undefined;
  const repo = createSkillPackageRepo({ ...db, prepare(sql) {
    const statement = db.prepare(sql);
    if (sql.startsWith("SELECT * FROM skill_packages WHERE package_id")) readBack = statement;
    return statement;
  } }, { ownerHostId: OWNER });
  return { repo, readBack: readBack! };
}

describe("Skill actual SQLite commit observation", () => {
  it("observes an inserted row even when the repository cannot read its committed projection", () => {
    const { repo, readBack } = fixture(); const observedRevisions: number[][] = [];
    const committed = vi.fn(() => { observedRevisions.push(repo.list().map((row) => row.configRevision)); });
    vi.spyOn(readBack, "get").mockImplementationOnce(() => { throw new Error("projection read-back failed"); });
    expect(() => repo.insert(input, committed)).toThrow("projection read-back failed");
    expect(committed).toHaveBeenCalledExactlyOnceWith(["skills"]);
    expect(observedRevisions).toEqual([[1]]);
    expect(repo.list()).toEqual([expect.objectContaining({ configRevision: 1, enabled: true })]);
  });

  it("observes an updated row after optimistic commit and before a failed second read", () => {
    const { repo, readBack } = fixture(); const row = repo.insert(input); const observedRevisions: number[][] = [];
    const committed = vi.fn(() => { observedRevisions.push(repo.list().map((item) => item.configRevision)); });
    const get = readBack.get;
    vi.spyOn(readBack, "get").mockImplementationOnce(get).mockImplementationOnce(() => { throw new Error("projection read-back failed"); });
    expect(() => repo.update({ packageId: row.packageId, expectedConfigRevision: 1, enabled: false }, committed)).toThrow("projection read-back failed");
    expect(committed).toHaveBeenCalledExactlyOnceWith(["skills"]);
    expect(observedRevisions).toEqual([[2]]);
    expect(repo.get(row.packageId)).toMatchObject({ configRevision: 2, enabled: false });
  });

  it("does not notify refused writes and isolates observers at accepted commit and deletion", () => {
    const { repo } = fixture(); const row = repo.insert(input); const committed = vi.fn(() => { throw new Error("observer failed"); });
    expect(() => repo.insert(input, committed)).toThrow();
    expect(() => repo.update({ packageId: row.packageId, expectedConfigRevision: 9, enabled: false }, committed)).toThrow();
    expect(() => repo.remove({ packageId: row.packageId, expectedConfigRevision: 9 }, committed)).toThrow();
    expect(committed).not.toHaveBeenCalled();
    expect(repo.update({ packageId: row.packageId, expectedConfigRevision: 1, enabled: false }, committed)).toMatchObject({ configRevision: 2 });
    expect(() => repo.remove({ packageId: row.packageId, expectedConfigRevision: 2 }, committed)).not.toThrow();
    expect(committed.mock.calls).toEqual([[["skills"]], [["skills"]]]);
    expect(repo.list()).toEqual([]);
  });
});
