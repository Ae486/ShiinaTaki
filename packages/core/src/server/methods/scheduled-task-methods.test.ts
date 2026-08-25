import { describe, expect, it, vi } from "vitest";
import { JSON_RPC_APP_ERROR, SCHEDULED_TASK_METHODS } from "@taki/shared";
import { createMethodRegistry } from "../method-registry.ts";
import { ScheduledTaskConflictError } from "../../db/scheduled-task-repo.ts";
import { registerScheduledTaskMethods } from "./scheduled-task-methods.ts";
const context = { connection: { state: { status: "authenticated" as const, role: "operator" as const, deviceId: "d", capabilities: [] } }, notify: vi.fn(), close: vi.fn(), onClose: vi.fn() };
describe("Scheduled Task methods", () => {
  it("registers all operator mutations over one service", async () => { const service = { list: vi.fn(() => []), create: vi.fn((p) => ({ taskId: "task", ...p })), update: vi.fn(), pause: vi.fn(), resume: vi.fn(), delete: vi.fn() }; const registry = createMethodRegistry(); registerScheduledTaskMethods(registry, service as never); const response = await registry.dispatch({ jsonrpc: "2.0", id: 1, method: SCHEDULED_TASK_METHODS.list, params: {} }, context as never); expect(response).toMatchObject({ result: { tasks: [] } }); expect(service.list).toHaveBeenCalledOnce(); });
  it("maps revision conflicts to a structured application error", async () => { const service = { list: vi.fn(() => []), create: vi.fn(), update: vi.fn(() => { throw new ScheduledTaskConflictError(4); }), pause: vi.fn(), resume: vi.fn(), delete: vi.fn() }; const registry = createMethodRegistry(); registerScheduledTaskMethods(registry, service as never); const response = await registry.dispatch({ jsonrpc: "2.0", id: 2, method: SCHEDULED_TASK_METHODS.update, params: { taskId: "task", expectedRevision: 1, characterId: "taki", name: "x", controlInput: "y", pattern: { kind: "at", at: "2026-08-25T00:00:00.000Z" }, timezone: { kind: "user" } } }, context as never); expect(response).toMatchObject({ error: { code: JSON_RPC_APP_ERROR, data: { code: "SCHEDULE_CONFLICT", currentRevision: 4 } } }); });
});
