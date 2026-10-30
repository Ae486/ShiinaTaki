import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InteractionPatternMutationResult, InteractionPatternView } from "@taki/shared";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createConfigSource } from "../config/config-source.ts";
import { createConfigWriter } from "../config/config-writer.ts";
import { createUserTimezoneRepo } from "../db/user-timezone-repo.ts";
import { createUserTimezoneService } from "../time/user-timezone-service.ts";
import { createSkillPackageRepo } from "../skills/skill-package-repo.ts";
import { createSkillCatalogManager, type SkillCatalogManager } from "../skills/skill-catalog-manager.ts";
import { createSkillLifecycleService } from "../skills/skill-lifecycle-service.ts";
import { createInteractionPatternService } from "./patterns/pattern-service.ts";
import { createAuthoringSkillSetup } from "./authoring-skill.ts";
import { createInitiativeSetup } from "./initiative-setup.ts";

const roots: string[] = []; const dbs: Database[] = []; const catalogs: SkillCatalogManager[] = [];
afterEach(() => {
  for (const catalog of catalogs.splice(0)) catalog.close();
  for (const db of dbs.splice(0)) db.close();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("taki-initiative-setup-")) throw new Error("unsafe fixture root");
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture(onChanged: (characterId: string) => void = vi.fn()) {
  const root = mkdtempSync(join(tmpdir(), "taki-initiative-setup-")); roots.push(root);
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const repo = createConfigRepo(db);
  const env = { TAKI_PROVIDER_API_KEY: "test-secret-never-expose" };
  const config = createConfigSource({ repo, env });
  const writer = createConfigWriter({ repo, env });
  const timezone = createUserTimezoneService({ db, repo: createUserTimezoneRepo(db),
    schedules: { recomputeUserTimezone: vi.fn() }, isOperatorDevice: () => true, logger: { warn: vi.fn() } });
  const catalog = createSkillCatalogManager({ root }); catalogs.push(catalog);
  const skills = createSkillLifecycleService({ repo: createSkillPackageRepo(db, { ownerHostId: "11111111-1111-4111-8111-111111111111" }),
    catalog, storeRoot: root, ownerHostId: "11111111-1111-4111-8111-111111111111" });
  const patterns = createInteractionPatternService({ db });
  const setup = createInitiativeSetup({ config, timezone, patterns, skill: createAuthoringSkillSetup(skills),
    sources: () => ({ activityAvailable: false, application: null, presence: "unknown", intentionAvailable: false }),
    completions: (characterId) => characterId === "taki" ? [{ runId: "known-result", label: "Known background result" }] : [],
    targetReady: (characterId) => characterId === "taki", onChanged });
  return { db, repo, config, writer, timezone, catalog, skills, patterns, setup, onChanged };
}
function success(value: InteractionPatternMutationResult): InteractionPatternView {
  expect(value.status).toBe("applied"); if (value.status === "refused") throw new Error(value.reason); return value.pattern;
}

describe("explicit initiative setup", () => {
  it("projects real configuration, timezone and source uncertainty without enabling dispatch or revealing secrets", () => {
    const f = fixture();
    expect(f.setup.read("taki")).toMatchObject({ targetCharacterId: null, targetReady: false, timezone: "UTC", timezoneConfirmed: false,
      sources: { activityAvailable: false, application: null, presence: "unknown", intentionAvailable: false }, skill: { state: "missing" } });
    expect(f.repo.all().size).toBe(0);
    f.writer.set({ key: "TAKI_INITIATIVE_TARGET_CHARACTER", value: "taki" });
    f.timezone.update({ expectedRevision: 1, mode: "fixed", timezone: "Asia/Tokyo" }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const status = f.setup.read("taki");
    expect(status).toMatchObject({ targetCharacterId: "taki", targetReady: true, timezone: "Asia/Tokyo", timezoneConfirmed: true,
      completions: [{ runId: "known-result", label: "Known background result" }] });
    expect(status.settings.every((entry) => entry.key.startsWith("TAKI_INITIATIVE_") && !entry.secret)).toBe(true);
    expect(JSON.stringify(status)).not.toContain("test-secret-never-expose");
    expect(f.config.resolve("TAKI_INITIATIVE_ENABLED")?.value).toBe(false);
    expect(f.setup.read("other").completions).toEqual([]);
  });

  it("proposes one reviewable seed and preserves user revisions, pending candidates and pause on reimport", () => {
    const f = fixture();
    const params = { characterId: "taki", commandId: "seed", seedId: "evening-reflection" as const };
    const candidate = success(f.setup.proposeSeed(params));
    expect(candidate.state).toBe("proposed"); expect(f.patterns.listActive("taki")).toEqual([]);
    const operator = { kind: "operator", operatorId: "owner" } as const;
    const active = success(f.patterns.confirm({ characterId: "taki", patternId: candidate.patternId, commandId: "confirm",
      expectedVersion: candidate.version, candidateRevisionId: candidate.candidateRevision!.revisionId }, operator));
    const paused = success(f.patterns.changeState({ characterId: "taki", patternId: active.patternId, commandId: "pause",
      expectedVersion: active.version, action: "pause" }, operator));
    const pending = success(f.patterns.propose({ characterId: "taki", patternId: paused.patternId, commandId: "edit",
      expectedVersion: paused.version, definition: { ...paused.effectiveRevision!.definition, title: "My requested habit" } }, operator));
    expect(f.setup.proposeSeed({ ...params, commandId: "new-import" })).toEqual({ status: "duplicate", pattern: pending });
    expect(f.setup.read("taki").seeds[0]?.existingPatternId).toBe(pending.patternId);
    const copy = f.setup.read("taki").seeds[0]!.definition;
    copy.title = "Mutated view";
    expect(f.setup.read("taki").seeds[0]?.definition.title).not.toBe(copy.title);
    expect(f.db.prepare("SELECT count(*) AS count FROM interaction_patterns").get()?.count).toBe(1);
  });

  it("rejects unknown seed IDs before creating a candidate", () => {
    const f = fixture();
    expect(f.setup.proposeSeed({ characterId: "taki", commandId: "invalid", seedId: "not-a-seed" } as never))
      .toMatchObject({ status: "refused", reason: "invalid_request" });
    expect(f.db.prepare("SELECT * FROM interaction_patterns").all()).toEqual([]);
  });

  it("installs the standard Skill and reports the committed status despite an observer failure", async () => {
    const onChanged = vi.fn(() => { throw new Error("disconnected observer"); });
    const f = fixture(onChanged);
    expect(await f.setup.installSkill("taki")).toMatchObject({ status: "installed", reason: null, setup: { skill: { state: "ready" } } });
    expect(onChanged).toHaveBeenCalledWith("taki");
    expect(await f.setup.installSkill("taki")).toMatchObject({ status: "unchanged" });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(f.patterns.listActive("taki")).toEqual([]);
    expect(f.config.resolve("TAKI_INITIATIVE_ENABLED")?.value).toBe(false);
  });

  it("validates the requested Character before installing a package", async () => {
    const f = fixture();
    await expect(f.setup.installSkill("")).rejects.toThrow();
    expect(f.skills.list().packages).toEqual([]);
  });
});
