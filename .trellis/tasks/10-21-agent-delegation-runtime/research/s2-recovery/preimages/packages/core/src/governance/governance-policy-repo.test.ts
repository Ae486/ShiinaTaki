import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createGovernancePolicyRepo, PolicyConflictError } from "./governance-policy-repo.ts";

const dbs: Database[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmTempDir(dir);
});

function open() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return { db, repo: createGovernancePolicyRepo(db) };
}

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-governance-"));
  dirs.push(dir);
  return join(dir, "taki.db");
}

describe("createGovernancePolicyRepo", () => {
  it("increments exactly once for material mutations and zero times for no-ops", () => {
    const { repo } = open();
    expect(repo.setLevel("standard", 1).policyGeneration).toBe(1);
    expect(repo.setLevel("strict", 1).policyGeneration).toBe(2);
    expect(repo.setOverride({ key: "screenshot", level: "strict", posture: "deny", descriptorRevision: 1, expectedPolicyGeneration: 2 }).policyGeneration).toBe(3);
    expect(repo.setOverride({ key: "screenshot", level: "strict", posture: "deny", descriptorRevision: 1, expectedPolicyGeneration: 3 }).policyGeneration).toBe(3);
    expect(repo.setOverride({ key: "screenshot", level: "strict", posture: null, descriptorRevision: 1, expectedPolicyGeneration: 3 }).policyGeneration).toBe(4);
  });

  it("returns a structured stale-writer conflict without changing state", () => {
    const { repo } = open();
    repo.setLevel("strict", 1);
    expect(() => repo.setLevel("relaxed", 1)).toThrow(PolicyConflictError);
    try { repo.setLevel("relaxed", 1); } catch (error) {
      expect((error as PolicyConflictError).currentPolicyGeneration).toBe(2);
    }
    expect(repo.read()).toMatchObject({ level: "strict", policyGeneration: 2 });
  });

  it("persists across a real file-backed close and reopen", () => {
    const file = tempFile();
    const first = openDatabase({ path: file, migrations: MIGRATIONS });
    dbs.push(first);
    const repo = createGovernancePolicyRepo(first);
    repo.setLevel("relaxed", 1);
    repo.setOverride({ key: "screenshot", level: "relaxed", posture: "deny", descriptorRevision: 1, expectedPolicyGeneration: 2 });
    first.close();

    const second = openDatabase({ path: file, migrations: MIGRATIONS });
    dbs.push(second);
    expect(createGovernancePolicyRepo(second).read()).toMatchObject({
      level: "relaxed", policyGeneration: 3, overrides: [{ key: "screenshot", posture: "deny" }],
    });
  });

  it("advances once on a registry upgrade, removes incompatible overrides, and rejects downgrade", () => {
    const { db, repo } = open();
    repo.setOverride({ key: "screenshot", level: "standard", posture: "deny", descriptorRevision: 1, expectedPolicyGeneration: 1 });
    const upgraded = repo.reconcileRegistry(2, new Set());
    expect(upgraded).toMatchObject({ registryRevision: 2, policyGeneration: 3, overrides: [] });
    expect(() => createGovernancePolicyRepo(db).reconcileRegistry(1, new Set())).toThrow(/newer than code/);
  });
});
