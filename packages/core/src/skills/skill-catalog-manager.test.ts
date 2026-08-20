import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSkillCatalogManager } from "./skill-catalog-manager.ts";
import { validateSkillFiles, publishSkill } from "./skill-package-store.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("Skill catalog generations", () => {
  it("publishes only enabled hash-verified rows and rejects tampering", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-catalog-")); dirs.push(root); const manager = createSkillCatalogManager({ root });
    const validated = validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: demo\n---\n\nbody") }]);
    publishSkill(root, "22222222-2222-4222-8222-222222222222", validated);
    const row = { packageId: "22222222-2222-4222-8222-222222222222", skillName: "demo", description: "demo", ownerHostId: OWNER, contentHash: validated.hash, lifecycleState: "active" as const, enabled: true, sourceKind: "directory" as const, sourceLocator: "browser-directory", trust: "operator-local" as const, scanVersion: "v1", scanVerdict: "passed" as const, scanFindings: [], failureReason: null, configRevision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    expect(manager.reconcile([row]).invalidated).toEqual([]); expect(manager.load("demo")).toMatchObject({ content: "\nbody" });
    writeFileSync(join(root, "published", "demo", validated.hash.slice(7), "SKILL.md"), "tampered");
    expect(manager.reconcile([row]).invalidated).toEqual([row.packageId]); expect(manager.load("demo")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
  it("keeps durable content across disable and re-enable", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-catalog-")); dirs.push(root); const manager = createSkillCatalogManager({ root });
    const validated = validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: demo\n---\nbody") }]); publishSkill(root, "22222222-2222-4222-8222-222222222222", validated);
    const row = packageRow(validated.hash, true); manager.reconcile([row]); const published = join(root, "published", "demo", validated.hash.slice(7));
    manager.reconcile([{ ...row, enabled: false, configRevision: 2 }]); expect(existsSync(published)).toBe(true);
    expect(manager.reconcile([{ ...row, enabled: true, configRevision: 3 }]).invalidated).toEqual([]); expect(manager.load("demo")).toMatchObject({ contentRevision: validated.hash });
  });
  it("verifies disabled durable content and invalidates it after tampering", () => { const root = mkdtempSync(join(tmpdir(), "skill-catalog-")); dirs.push(root); const manager = createSkillCatalogManager({ root }); const validated = validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: demo\n---\nbody") }]); const content = publishSkill(root, "22222222-2222-4222-8222-222222222222", validated); const row = packageRow(validated.hash, false); expect(manager.reconcile([row]).invalidated).toEqual([]); writeFileSync(join(content.root, "SKILL.md"), "tampered"); expect(manager.reconcile([row]).invalidated).toEqual([row.packageId]); });
  it("rejects a published root that is swapped for an external directory link", () => { const root = mkdtempSync(join(tmpdir(), "skill-catalog-")); const external = mkdtempSync(join(tmpdir(), "skill-catalog-external-")); dirs.push(root, external); const manager = createSkillCatalogManager({ root }); const validated = validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: demo\n---\nbody") }]); const content = publishSkill(root, "22222222-2222-4222-8222-222222222222", validated); const row = packageRow(validated.hash, true); manager.reconcile([row]); const linked = join(external, "payload"); mkdirSync(linked, { recursive: true }); writeFileSync(join(linked, "SKILL.md"), Buffer.from("---\nname: demo\ndescription: demo\n---\nbody")); rmSync(content.root, { recursive: true, force: true }); symlinkSync(linked, content.root, process.platform === "win32" ? "junction" : "dir"); expect(manager.reconcile([row]).invalidated).toEqual([row.packageId]); });
  it("loads standards-compatible block metadata through the same parser", () => { const root = mkdtempSync(join(tmpdir(), "skill-catalog-")); dirs.push(root); const manager = createSkillCatalogManager({ root }); const validated = validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: |\n  Demo skill.\nmetadata:\n  team: tools\n---\n\n# Body") }]); publishSkill(root, "22222222-2222-4222-8222-222222222222", validated); manager.reconcile([packageRow(validated.hash, true)]); expect(manager.load("demo")).toMatchObject({ content: "\n# Body" }); });
  it("holds an old replacement root until its generation lease drains", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-catalog-")); dirs.push(root); const manager = createSkillCatalogManager({ root });
    const first = validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: demo\n---\nfirst") }]); const second = validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: demo\n---\nsecond") }]);
    publishSkill(root, "22222222-2222-4222-8222-222222222222", first); manager.reconcile([packageRow(first.hash, true)]);
    const lease = manager.acquire("demo"); expect(lease).toBeDefined(); const oldRoot = lease!.entry.root;
    publishSkill(root, "22222222-2222-4222-8222-222222222222", second); manager.reconcile([{ ...packageRow(second.hash, true), configRevision: 2 }]);
    expect(existsSync(oldRoot)).toBe(true); lease!.release(); expect(existsSync(oldRoot)).toBe(false); expect(manager.load("demo")).toMatchObject({ contentRevision: second.hash });
  });
  it("preserves every leased retired generation and every disabled durable root", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-catalog-")); dirs.push(root); const manager = createSkillCatalogManager({ root });
    const content = (name: string, body: string) => validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from(`---\nname: ${name}\ndescription: ${name}\n---\n${body}`) }]);
    const first = content("demo", "one"); publishSkill(root, "22222222-2222-4222-8222-222222222222", first); manager.reconcile([packageRow(first.hash, true)]); const firstLease = manager.acquire("demo")!;
    const second = content("demo", "two"); publishSkill(root, "22222222-2222-4222-8222-222222222222", second); manager.reconcile([{ ...packageRow(second.hash, true), configRevision: 2 }]); const secondLease = manager.acquire("demo")!;
    const third = content("demo", "three"); publishSkill(root, "22222222-2222-4222-8222-222222222222", third); const dormant = content("dormant", "sleep"); const dormantContent = publishSkill(root, "33333333-3333-4333-8333-333333333333", dormant);
    manager.reconcile([{ ...packageRow(third.hash, true), configRevision: 3 }, packageRow(dormant.hash, false, { skillName: "dormant", packageId: "33333333-3333-4333-8333-333333333333" })]);
    expect(existsSync(firstLease.entry.root)).toBe(true); expect(existsSync(secondLease.entry.root)).toBe(true); expect(existsSync(dormantContent.root)).toBe(true);
    firstLease.release(); expect(existsSync(firstLease.entry.root)).toBe(false); secondLease.release(); expect(existsSync(secondLease.entry.root)).toBe(false); expect(existsSync(dormantContent.root)).toBe(true);
  });
  it("does not leak mutable catalog entries and stops new leases on close", () => { const root = mkdtempSync(join(tmpdir(), "skill-catalog-")); dirs.push(root); const manager = createSkillCatalogManager({ root }); const validated = validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: demo\n---\nbody") }]); publishSkill(root, "22222222-2222-4222-8222-222222222222", validated); manager.reconcile([packageRow(validated.hash, true)]); const entry = manager.list()[0]!; expect(Object.isFrozen(entry)).toBe(true); expect(Object.isFrozen(entry.row)).toBe(true); expect(Object.isFrozen(entry.files)).toBe(true); expect(() => (entry.files as string[]).push("tamper")).toThrow(); manager.close(); expect(manager.acquire("demo")).toBeUndefined(); });
  it("collects crash-leftover staging and unreferenced published roots", () => { const root = mkdtempSync(join(tmpdir(), "skill-catalog-")); dirs.push(root); const manager = createSkillCatalogManager({ root }); const staging = join(root, "staging", "abandoned"); const orphan = join(root, "published", "orphan", "deadbeef"); mkdirSync(staging, { recursive: true }); mkdirSync(orphan, { recursive: true }); writeFileSync(join(staging, "x"), "x"); writeFileSync(join(orphan, "x"), "x"); manager.reconcile([]); expect(existsSync(staging)).toBe(false); expect(existsSync(orphan)).toBe(false); });
});
function packageRow(contentHash: string, enabled: boolean, options: { skillName?: string; packageId?: string } = {}) { const skillName = options.skillName ?? "demo"; return { packageId: options.packageId ?? "22222222-2222-4222-8222-222222222222", skillName, description: skillName, ownerHostId: OWNER, contentHash, lifecycleState: "active" as const, enabled, sourceKind: "directory" as const, sourceLocator: "browser-directory", trust: "operator-local" as const, scanVersion: "v1", scanVerdict: "passed" as const, scanFindings: [], failureReason: null, configRevision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; }
