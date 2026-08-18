/**
 * INPUT: candidate skill.* wire params and package projections
 * OUTPUT: strict protocol and Agent Skills metadata-boundary assertions
 * POS:    shared protocol parity test for Core and Home Skill lifecycle consumers
 */
import { describe, expect, it } from "vitest";
import { SKILL_METHODS, SkillImportParamsSchema, SkillInspectResultSchema, SkillPackageViewSchema } from "./skill-lifecycle-schema.ts";
const HOST = "11111111-1111-4111-8111-111111111111"; const NOW = "2026-08-18T00:00:00.000Z";
function view(name: string, description = "valid") { return { packageId: HOST, skillName: name, description, ownerHostId: HOST, contentHash: null, enabled: false, configRevision: 1, sourceKind: "directory", sourceLocator: "browser-directory", trust: "operator-local", scanVersion: "v1", scanVerdict: "passed", scanFindings: [], lifecycleState: "active", runtimeState: "disabled", catalogGeneration: null, createdAt: NOW, updatedAt: NOW, failureReason: null }; }
describe("Skill lifecycle schema", () => {
  it("freezes the operator method family", () => { expect(SKILL_METHODS).toEqual({ list: "skill.list", inspect: "skill.inspect", import: "skill.import", enable: "skill.enable", disable: "skill.disable", remove: "skill.remove", reconcile: "skill.reconcile" }); });
  it("enforces standard names and description bounds", () => { expect(SkillPackageViewSchema.safeParse(view("1-demo")).success).toBe(true); for (const name of ["-demo", "demo-", "demo--skill", "Demo", "a".repeat(65)]) expect(SkillPackageViewSchema.safeParse(view(name)).success).toBe(false); expect(SkillPackageViewSchema.safeParse(view("demo", "a".repeat(1_025))).success).toBe(false); });
  it("keeps import shapes strict and replacement revision-bearing", () => { const source = { kind: "directory", files: [{ path: "demo/SKILL.md", contentBase64: "eA==" }] }; expect(SkillImportParamsSchema.safeParse({ source }).success).toBe(true); expect(SkillImportParamsSchema.safeParse({ source, replacePackageId: HOST }).success).toBe(false); expect(SkillImportParamsSchema.safeParse({ source, replacePackageId: HOST, expectedConfigRevision: 1, extra: true }).success).toBe(false); });
  it("accepts only bounded ZIP basenames as public provenance", () => { expect(SkillImportParamsSchema.safeParse({ source: { kind: "zip", fileName: "demo.zip", archiveBase64: "" } }).success).toBe(true); for (const fileName of ["C:\\secret\\demo.zip", "/tmp/demo.zip", "folder/demo.zip", "bad:name.zip"]) expect(SkillImportParamsSchema.safeParse({ source: { kind: "zip", fileName, archiveBase64: "" } }).success).toBe(false); });
  it("projects only bounded standard metadata from inspect", () => { const metadata = { name: "demo", description: "Demo", license: "MIT", compatibility: "Node 24", metadata: { team: "tools" }, "allowed-tools": "read_file" }; expect(SkillInspectResultSchema.safeParse({ package: view("demo", "Demo"), metadata, files: ["SKILL.md"] }).success).toBe(true); expect(SkillInspectResultSchema.safeParse({ package: view("demo", "Demo"), metadata: { ...metadata, unknown: true }, files: [] }).success).toBe(false); });
});
