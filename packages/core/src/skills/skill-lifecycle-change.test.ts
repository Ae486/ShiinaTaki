import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import type { ExtensionChangeObserver, ExtensionChangeTarget } from "../extensions/notify-extension-change.ts";
import { createSkillCatalogManager } from "./skill-catalog-manager.ts";
import { createSkillLifecycleService } from "./skill-lifecycle-service.ts";
import { createSkillPackageRepo } from "./skill-package-repo.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const databases: Database[] = [];
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function source(name = "demo", body = "body") {
  return { kind: "directory" as const, files: [
    { path: `${name}/SKILL.md`, contentBase64: Buffer.from(`---\nname: ${name}\ndescription: ${name}\n---\n${body}`).toString("base64") },
    { path: `${name}/references/help.txt`, contentBase64: Buffer.from("help").toString("base64") },
  ] };
}

function harness(observer?: ExtensionChangeObserver) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  databases.push(db);
  const root = mkdtempSync(join(tmpdir(), "skill-change-")); roots.push(root);
  const repo = createSkillPackageRepo(db, { ownerHostId: OWNER });
  const catalog = createSkillCatalogManager({ root });
  const changes: { targets: readonly ExtensionChangeTarget[]; generation: number; revisions: number[] }[] = [];
  const service = createSkillLifecycleService({ repo, catalog, storeRoot: root, ownerHostId: OWNER, onChange: (targets) => {
    changes.push({ targets: [...targets], generation: catalog.currentGeneration(), revisions: repo.list().map((row) => row.configRevision) });
    observer?.(targets);
  } });
  return { root, repo, catalog, service, changes };
}

describe("Skill committed list and catalog change observation", () => {
  it("invalidates an inert rejected import without inventing a catalog generation change", async () => {
    const h = harness();
    const rejected = await h.service.import({ source: { kind: "directory", files: [{ path: "broken/SKILL.md", contentBase64: Buffer.from("no frontmatter").toString("base64") }] } });
    expect(rejected.package.lifecycleState).toBe("rejected");
    expect(h.changes).toEqual([{ targets: ["skills"], generation: 0, revisions: [1] }]);
    expect(h.catalog.list()).toEqual([]);
  });

  it("observes commits and coherent publication for import, replacement, enable, disable, remove and reconcile", async () => {
    const h = harness();
    const first = (await h.service.import({ source: source() })).package;
    const prior = h.catalog.list()[0]!;
    const replacement = (await h.service.import({ source: source("demo", "replacement"), replacePackageId: first.packageId, expectedConfigRevision: 1 })).package;
    const disabled = (await h.service.disable({ packageId: first.packageId, expectedConfigRevision: replacement.configRevision })).package;
    const enabled = (await h.service.enable({ packageId: first.packageId, expectedConfigRevision: disabled.configRevision })).package;
    await h.service.remove({ packageId: first.packageId, expectedConfigRevision: enabled.configRevision });
    await h.service.reconcile();
    expect(h.changes).toEqual([
      { targets: ["skills"], generation: 0, revisions: [1] },
      { targets: ["skills", "extension-status"], generation: 1, revisions: [1] },
      { targets: ["skills"], generation: 1, revisions: [2] },
      { targets: ["skills", "extension-status"], generation: 2, revisions: [2] },
      { targets: ["skills"], generation: 2, revisions: [3] },
      { targets: ["skills", "extension-status"], generation: 3, revisions: [3] },
      { targets: ["skills"], generation: 3, revisions: [4] },
      { targets: ["skills", "extension-status"], generation: 4, revisions: [4] },
      { targets: ["skills"], generation: 4, revisions: [] },
      { targets: ["skills", "extension-status"], generation: 5, revisions: [] },
      { targets: ["skills", "extension-status"], generation: 6, revisions: [] },
    ]);
    expect(prior.row.configRevision).toBe(1);
    expect(prior.row.contentHash).toBe(first.contentHash);
    expect(Object.isFrozen(prior.row)).toBe(true);
  });

  it("retains a committed list invalidation when catalog publication fails before its swap", async () => {
    const h = harness();
    vi.spyOn(h.catalog, "publish").mockImplementationOnce(() => { throw new Error("publication failed"); });
    await expect(h.service.import({ source: source() })).rejects.toThrow("publication failed");
    expect(h.repo.list()).toHaveLength(1);
    expect(h.catalog.currentGeneration()).toBe(0);
    expect(h.changes).toEqual([{ targets: ["skills"], generation: 0, revisions: [1] }]);
  });

  it("observes publication before unrelated GC failure and every surviving partial reconcile commit", async () => {
    const h = harness();
    vi.spyOn(h.catalog, "collectGarbage").mockImplementationOnce(() => { throw new Error("GC failed"); });
    await expect(h.service.import({ source: source() })).rejects.toThrow("GC failed");
    expect(h.changes.at(-1)).toEqual({ targets: ["skills", "extension-status"], generation: 1, revisions: [1] });
    await h.service.import({ source: source("second") });
    for (const row of h.repo.list()) writeFileSync(join(h.root, "published", row.skillName!, row.contentHash!.slice(7), "SKILL.md"), "tampered");
    h.changes.length = 0;
    const update = h.repo.update;
    vi.spyOn(h.repo, "update").mockImplementationOnce(update).mockImplementationOnce(() => { throw new Error("second commit failed"); });
    await expect(h.service.reconcile()).rejects.toThrow("second commit failed");
    expect(h.repo.list().filter((row) => row.lifecycleState === "rejected")).toHaveLength(1);
    expect(h.changes).toEqual([{ targets: ["skills"], generation: 2, revisions: [2, 1] }]);
  });

  it("does not notify failed precommit validation/conflict, ordinary inspection, reads, leases or GC", async () => {
    const h = harness();
    const imported = (await h.service.import({ source: source() })).package;
    h.changes.length = 0;
    await expect(h.service.import({ source: source() })).rejects.toMatchObject({ reason: "duplicate-skill" });
    await expect(h.service.disable({ packageId: imported.packageId, expectedConfigRevision: 9 })).rejects.toThrow();
    h.service.list(); h.service.inspect({ packageId: imported.packageId });
    expect(h.catalog.load("demo")).toMatchObject({ content: "body" });
    expect(h.catalog.readResource("demo", "references/help.txt")).toMatchObject({ ok: true });
    const lease = h.catalog.acquire("demo")!;
    lease.release(); h.catalog.collectGarbage();
    expect(h.changes).toEqual([]);
  });

  it("isolates a failing observer from publication and subsequent serialized commands", async () => {
    const h = harness(() => { throw new Error("observer failed"); });
    const imported = (await h.service.import({ source: source() })).package;
    await expect(h.service.disable({ packageId: imported.packageId, expectedConfigRevision: 1 })).resolves.toMatchObject({ package: { enabled: false } });
    expect(h.catalog.currentGeneration()).toBe(2);
    expect(h.changes).toHaveLength(4);
  });
});
