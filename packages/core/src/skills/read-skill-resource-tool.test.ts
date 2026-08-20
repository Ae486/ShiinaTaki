import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createSkillCatalogManager } from "./skill-catalog-manager.ts";
import { publishSkill, validateSkillFiles } from "./skill-package-store.ts";
import { createReadSkillResourceTool } from "./read-skill-resource-tool.ts";
import { createSkillsLoader } from "./skills-loader.ts";
const OWNER = "11111111-1111-4111-8111-111111111111"; const roots: string[] = []; const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function harness() { const root = mkdtempSync(join(tmpdir(), "skill-resource-")); roots.push(root); const validated = validateSkillFiles([{ path: "SKILL.md", bytes: Buffer.from("---\nname: demo\ndescription: demo\n---\nbody") }, { path: "references/help.txt", bytes: Buffer.from("help") }, { path: "references/binary.bin", bytes: Buffer.from([0, 1, 2]) }]); publishSkill(root, "22222222-2222-4222-8222-222222222222", validated); const manager = createSkillCatalogManager({ root }); manager.reconcile([{ packageId: "22222222-2222-4222-8222-222222222222", skillName: "demo", description: "demo", ownerHostId: OWNER, contentHash: validated.hash, lifecycleState: "active", enabled: true, sourceKind: "directory", sourceLocator: "browser-directory", trust: "operator-local", scanVersion: "v1", scanVerdict: "passed", scanFindings: [], failureReason: null, configRevision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]); const state = { isDisabled: () => false, disable: () => undefined, enable: () => undefined, listDisabled: () => [] }; return { loader: createSkillsLoader({ skills: [], state, catalog: manager }) }; }
async function execute(tool: ReturnType<typeof createReadSkillResourceTool>, path: string) { return tool.read_skill_resource?.execute?.({ name: "demo", path }, { toolCallId: "c1", messages: [] } as never); }
describe("read_skill_resource", () => {
  it("reads confined UTF-8 support data and rejects manifest, traversal, ADS, and binary controls", async () => { const { loader } = harness(); const tool = createReadSkillResourceTool(loader); expect(await execute(tool, "references/help.txt")).toMatchObject({ ok: true, content: "help" }); for (const path of ["SKILL.md", "../escape", "references\\help.txt", "references/help.txt:stream", "references/binary.bin"]) expect(await execute(tool, path)).toMatchObject({ ok: false }); });
  it("uses the same governed skill.load / skill-load identity", async () => { const { loader } = harness(); const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db); const service = createGovernancePolicyService(createGovernancePolicyRepo(db)); const authorize = vi.spyOn(service, "authorize").mockReturnValue({ allowed: false, code: "GOVERNANCE_DENIED" } as never); const tool = createReadSkillResourceTool(loader, { service, ownerHostId: OWNER }); expect(await execute(tool, "references/help.txt")).toMatchObject({ ok: false, code: "GOVERNANCE_DENIED" }); expect(authorize).toHaveBeenCalledWith({ identity: { capabilityId: "skill.load", ownerHostId: OWNER, subject: { subjectId: "skill.demo", revision: expect.stringMatching(/^sha256\./u) } }, cellKey: "skill-load" }); });
  it("publishes strict described arguments and complete sibling/result guidance", () => { const definition = createReadSkillResourceTool(harness().loader).read_skill_resource!; const schema = definition.inputSchema as z.ZodObject<{ name: z.ZodString; path: z.ZodString }>; expect(schema.safeParse({ name: "demo", path: "references/help.txt", extra: true }).success).toBe(false); expect(schema.shape.name.description).toBeTruthy(); expect(schema.shape.path.description).toBeTruthy(); expect(definition.description).toContain("load_skill"); expect(definition.description).toContain("structured failures"); });
});
