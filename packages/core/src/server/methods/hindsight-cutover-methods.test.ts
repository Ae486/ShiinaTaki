import { describe, expect, it, vi } from "vitest";
import { HINDSIGHT_CUTOVER_METHODS, JSON_RPC_APP_ERROR } from "@taki/shared";
import type { HindsightCutoverRunRepo } from "../../db/hindsight-cutover-run-repo.ts";
import type { Logger } from "../../logging/logger.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerHindsightCutoverMethods } from "./hindsight-cutover-methods.ts";

const status = {
  runId: "run", setupRevision: 1, phase: "ready", status: "ready", expectedPredecessorEpochId: "epoch",
  lease: { active: true, fence: 1, expiresAt: "2026-08-22T01:00:00.000Z" }, sourceCount: 1, factMappingCount: 1,
  checkpointCount: 1,
  operationCounts: { pending: 0, submitted: 0, processing: 0, completed: 0, mapped: 1, failed: 0, cancelled: 0, conflict: 0, excluded: 0 },
  authority: { mode: "canonical-local", epochId: "epoch" }, updatedAt: "2026-08-22T00:00:00.000Z",
} as const;

const ctx = (role: "operator" | "agent"): MethodContext => ({
  connection: { state: { status: "authenticated", role, deviceId: "device" } } as Connection,
  notify: vi.fn(), close: vi.fn(), onClose: vi.fn(),
});
const logger = { child: () => ({ error: vi.fn() }) } as unknown as Logger;

describe("Hindsight cutover methods", () => {
  it("keeps status and verify operator-only and bounded", async () => {
    const repo = { status: vi.fn(() => status), verify: vi.fn(() => ({ runId: "run", expectedRevision: 1, expectedEpochId: "epoch", eligible: true, blockingCodes: [], status })) } as unknown as HindsightCutoverRunRepo;
    const registry = createMethodRegistry(); registerHindsightCutoverMethods(registry, { repo, logger });
    await expect(registry.dispatch({ jsonrpc: "2.0", id: 1, method: HINDSIGHT_CUTOVER_METHODS.status, params: { runId: "run" } }, ctx("operator"))).resolves.toMatchObject({ result: { runId: "run", sourceCount: 1 } });
    await expect(registry.dispatch({ jsonrpc: "2.0", id: 2, method: HINDSIGHT_CUTOVER_METHODS.verify, params: { runId: "run", expectedRevision: 1, expectedEpochId: "epoch" } }, ctx("operator"))).resolves.toMatchObject({ result: { eligible: true } });
    await expect(registry.dispatch({ jsonrpc: "2.0", id: 3, method: HINDSIGHT_CUTOVER_METHODS.status, params: { runId: "run" } }, ctx("agent"))).resolves.toMatchObject({ error: { code: JSON_RPC_APP_ERROR, data: { code: "FORBIDDEN" } } });
  });

  it("does not expose source text or call a remote dependency", async () => {
    const repo = { status: vi.fn(() => status), verify: vi.fn(() => ({ runId: "run", expectedRevision: 1, expectedEpochId: "epoch", eligible: false, blockingCodes: ["HINDSIGHT_IMPORT_UNRESOLVED"], status })) } as unknown as HindsightCutoverRunRepo;
    const registry = createMethodRegistry(); registerHindsightCutoverMethods(registry, { repo, logger });
    const response = await registry.dispatch({ jsonrpc: "2.0", id: 4, method: HINDSIGHT_CUTOVER_METHODS.verify, params: { runId: "run", expectedRevision: 1, expectedEpochId: "epoch" } }, ctx("operator"));
    expect(JSON.stringify(response)).not.toContain("source text");
    expect(repo.verify).toHaveBeenCalledWith({ runId: "run", expectedRevision: 1, expectedEpochId: "epoch" });
  });
});
