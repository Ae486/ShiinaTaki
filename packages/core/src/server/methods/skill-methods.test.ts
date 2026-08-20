/**
 * INPUT: operator/node registry dispatches over the skill.* method family
 * OUTPUT: role, strict params, bounded refusal, and optimistic conflict boundary assertions
 * POS:    core/server/methods Skill operator-surface regression test
 */
import { describe, expect, it } from "vitest";
import { JSON_RPC_APP_ERROR, SKILL_METHODS } from "@taki/shared";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { SkillRefusedError, type SkillLifecycleService } from "../../skills/skill-lifecycle-service.ts";
import { SkillConfigConflictError } from "../../skills/skill-package-repo.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerSkillMethods } from "./skill-methods.ts";
const ID = "11111111-1111-4111-8111-111111111111";
function service(): SkillLifecycleService { return { list: () => ({ packages: [], catalogGeneration: 1 }), inspect: () => { throw new SkillRefusedError("unknown-package"); }, import: async () => { throw new SkillRefusedError("unsafe-package"); }, enable: async () => { throw new SkillConfigConflictError(3); }, disable: async () => { throw new SkillRefusedError("package-disabled"); }, remove: async () => ({ status: "removed", packageId: ID }), reconcile: async () => ({ checked: 0, invalidated: 0, catalogGeneration: 1 }) }; }
async function call(method: string, params: unknown, target: "operator" | "node" | SkillLifecycleService = "operator") { const registry = createMethodRegistry(); registerSkillMethods(registry, { service: typeof target === "string" ? service() : target, logger: createCaptureLogger().logger }); const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role: typeof target === "string" ? target : "operator", capabilities: [] } }; const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined }; return registry.dispatch({ jsonrpc: "2.0", id: 1, method, params }, ctx); }
describe("Skill methods", () => {
  it("keeps the complete family operator-only", async () => { for (const [method, params] of [[SKILL_METHODS.list, {}], [SKILL_METHODS.inspect, { packageId: ID }], [SKILL_METHODS.import, { source: { kind: "directory", files: [{ path: "demo/SKILL.md", contentBase64: "eA==" }] } }], [SKILL_METHODS.enable, { packageId: ID, expectedConfigRevision: 1 }], [SKILL_METHODS.disable, { packageId: ID, expectedConfigRevision: 1 }], [SKILL_METHODS.remove, { packageId: ID, expectedConfigRevision: 1 }], [SKILL_METHODS.reconcile, {}]] as const) { const response = await call(method, params, "node") as { error: { data: { code: string } } }; expect(response.error.data.code).toBe("FORBIDDEN"); } });
  it("maps revision conflicts and refusals to bounded app errors", async () => { const conflict = await call(SKILL_METHODS.enable, { packageId: ID, expectedConfigRevision: 1 }) as { error: { code: number; data: { code: string; currentConfigRevision: number } } }; expect(conflict.error).toMatchObject({ code: JSON_RPC_APP_ERROR, data: { code: "SKILL_CONFIG_CONFLICT", currentConfigRevision: 3 } }); const refused = await call(SKILL_METHODS.inspect, { packageId: ID }) as { error: { data: { code: string; reason: string } } }; expect(refused.error.data).toEqual({ code: "SKILL_REFUSED", reason: "unknown-package" }); });
  it("rejects replacement imports without an expected revision at the Shared boundary", async () => { const response = await call(SKILL_METHODS.import, { source: { kind: "directory", files: [{ path: "demo/SKILL.md", contentBase64: "eA==" }] }, replacePackageId: ID }) as { error: { code: number } }; expect(response.error.code).toBe(-32602); });
  it("sanitizes internal schema failures instead of echoing parser details", async () => { const failure = new Error("raw database row contents"); failure.name = "ZodError"; const target = { ...service(), list: () => { throw failure; } }; const response = await call(SKILL_METHODS.list, {}, target) as { error: { code: number; message: string; data: { code: string } } }; expect(response.error).toMatchObject({ code: JSON_RPC_APP_ERROR, message: "skill lifecycle operation failed", data: { code: "INTERNAL_ERROR" } }); expect(JSON.stringify(response)).not.toContain("raw database row contents"); });
});
