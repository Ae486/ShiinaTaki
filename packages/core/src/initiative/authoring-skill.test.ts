import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createSkillPackageRepo } from "../skills/skill-package-repo.ts";
import { createSkillCatalogManager, type SkillCatalogManager } from "../skills/skill-catalog-manager.ts";
import { createSkillLifecycleService } from "../skills/skill-lifecycle-service.ts";
import { createAuthoringSkillSetup } from "./authoring-skill.ts";

const NAME = "companion-pattern-authoring";
const roots: string[] = [];
const databases: Database[] = [];
const catalogs: SkillCatalogManager[] = [];
afterEach(() => {
  for (const catalog of catalogs.splice(0)) catalog.close();
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-authoring-skill-")) throw new Error("unsafe fixture root");
    rmSync(root, { recursive: true, force: true });
  }
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "taki-authoring-skill-")); roots.push(root);
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const repo = createSkillPackageRepo(db, { ownerHostId: "11111111-1111-4111-8111-111111111111" });
  const catalog = createSkillCatalogManager({ root }); catalogs.push(catalog);
  const service = createSkillLifecycleService({ repo, catalog, storeRoot: root, ownerHostId: "11111111-1111-4111-8111-111111111111" });
  return { db, repo, catalog, service, setup: createAuthoringSkillSetup(service) };
}
function directory(content: string) {
  return { kind: "directory" as const, files: [{ path: `${NAME}/SKILL.md`, contentBase64: Buffer.from(content).toString("base64") }] };
}

describe("normal authoring Skill setup", () => {
  it("imports actual bundled bytes through the standard lifecycle and loads/discovers them", async () => {
    const f = setup();
    expect(f.setup.state()).toEqual({ state: "missing", packageId: null, configRevision: null });
    expect(await f.setup.install()).toEqual({ status: "installed", reason: null });
    const state = f.setup.state();
    expect(state).toMatchObject({ state: "ready", configRevision: 1 });
    expect(f.service.list().packages).toHaveLength(1);
    expect(f.service.inspect({ packageId: state.packageId! })).toMatchObject({ files: ["SKILL.md"], metadata: { name: NAME } });
    const loaded = f.catalog.load(NAME);
    expect(loaded).toMatchObject({ content: expect.stringContaining("manage_interaction_pattern") });
    expect(f.catalog.describe(NAME)?.contentRevision).toBe(f.service.list().packages[0]?.contentHash);
    expect(await f.setup.install()).toEqual({ status: "unchanged", reason: null });
    expect(f.setup.state()).toEqual(state);
  });

  it("preserves a user's same-name package and its immutable contents", async () => {
    const f = setup();
    const user = (await f.service.import({ source: directory(`---\nname: ${NAME}\ndescription: User-authored procedure\n---\nKeep my instructions.`) })).package;
    const before = f.repo.get(user.packageId);
    expect(f.setup.state()).toMatchObject({ state: "conflict", packageId: user.packageId });
    expect(await f.setup.install()).toEqual({ status: "refused", reason: "name-conflict" });
    expect(f.repo.get(user.packageId)).toEqual(before);
    expect(f.catalog.load(NAME)).toMatchObject({ content: expect.stringContaining("Keep my instructions.") });
  });

  it("does not re-enable an explicitly disabled exact bundled package", async () => {
    const f = setup();
    const content = readFileSync(new URL("../../resources/skills/companion-pattern-authoring/SKILL.md", import.meta.url), "utf8");
    const imported = (await f.service.import({ source: directory(content) })).package;
    const disabled = (await f.service.disable({ packageId: imported.packageId, expectedConfigRevision: imported.configRevision })).package;
    expect(f.setup.state()).toEqual({ state: "disabled", packageId: disabled.packageId, configRevision: disabled.configRevision });
    expect(await f.setup.install()).toEqual({ status: "refused", reason: "package-disabled" });
    expect(f.service.list().packages[0]).toEqual(disabled);
    expect(f.catalog.load(NAME)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("deduplicates concurrent explicit installs using the real serialized lifecycle", async () => {
    const f = setup();
    const results = await Promise.all([f.setup.install(), f.setup.install()]);
    expect(results.map((result) => result.status).sort()).toEqual(["installed", "unchanged"]);
    expect(f.service.list().packages).toHaveLength(1);
    expect(f.setup.state().state).toBe("ready");
  });

  it("reports an unavailable exact package without calling it a user-name collision", async () => {
    const f = setup();
    const content = readFileSync(new URL("../../resources/skills/companion-pattern-authoring/SKILL.md", import.meta.url), "utf8");
    await f.service.import({ source: directory(content) });
    f.catalog.close();
    expect(f.setup.state().state).toBe("unavailable");
    expect(await f.setup.install()).toEqual({ status: "refused", reason: "import-failed" });
  });
});
