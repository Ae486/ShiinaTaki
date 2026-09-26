import { describe, expect, it, vi } from "vitest";
import { createHindsightClient, type HindsightTransport } from "./hindsight-client.ts";
import { confirmHindsightRollback, hindsightCursorResetFailure, HindsightRollbackError } from "./hindsight-cursor-reset.ts";
import { hindsightError } from "./hindsight-errors.ts";
import { HINDSIGHT_DEFAULT_RESPONSE_BYTES } from "./hindsight-http-transport.ts";
import { replicaErrorCode, replicaResetRequired } from "./hindsight-replica-errors.ts";

const LINEAGE = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const context = { timeoutMs: 1_000 };

const body = (reason: string, patch: Record<string, unknown> = {}) => JSON.stringify({ error: "replication_cursor_reset_required", reason,
  bank_id: "bank", requested_cursor: 9, minimum_available_cursor: 0, current_cursor: 4, provider_lineage: LINEAGE, bank_generation: GENERATION, ...patch });

function client(response: { status: number; body: string }) {
  const transport = vi.fn<HindsightTransport>(async () => response);
  return createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "key", transport });
}

describe("native 409 cursor reset classification (§5.7)", () => {
  it.each([
    ["cursor_ahead", body("cursor_ahead"), "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED"],
    ["cursor_expired", body("cursor_expired"), "HINDSIGHT_CURSOR_RESET_REQUIRED"],
    ["an unknown reason", body("cursor_sideways"), "HINDSIGHT_CURSOR_RESET_REQUIRED"],
    ["another error envelope", body("cursor_ahead", { error: "other" }), "HINDSIGHT_CURSOR_RESET_REQUIRED"],
    ["a missing identity", body("cursor_ahead", { provider_lineage: undefined }), "HINDSIGHT_CURSOR_RESET_REQUIRED"],
    ["an empty object", "{}", "HINDSIGHT_CURSOR_RESET_REQUIRED"],
    ["plain text", "private cursor details", "HINDSIGHT_CURSOR_RESET_REQUIRED"],
    ["an oversized body", body("cursor_ahead", { pad: "x".repeat(HINDSIGHT_DEFAULT_RESPONSE_BYTES) }), "HINDSIGHT_CURSOR_RESET_REQUIRED"],
  ])("maps a /changes and /snapshots 409 with %s", async (_name, responseBody, code) => {
    const target = client({ status: 409, body: responseBody });
    const changes = target.changesAfter!({ bankId: "bank", afterCursor: 9, limit: 500, context });
    const snapshot = target.createLogicalSnapshot!({ bankId: "bank", pageSize: 1, ttlSeconds: 60, context });
    for (const request of [changes, snapshot]) {
      const error = await request.then(() => null, (failure: unknown) => failure);
      expect(error).toMatchObject({ code, message: code });
      expect(JSON.stringify(error)).not.toContain("cursor_");
    }
  });

  it("carries the native identity on a rollback, never retries it and never treats it as a replica reset", () => {
    const error = hindsightCursorResetFailure(body("cursor_ahead"));
    expect(error).toBeInstanceOf(HindsightRollbackError);
    expect(error).toMatchObject({ code: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED", retryable: false, providerLineageId: LINEAGE, bankGeneration: GENERATION });
    expect(replicaErrorCode(error)).toBe("HINDSIGHT_PROVIDER_ROLLBACK_DETECTED");
    expect(replicaResetRequired(error)).toBe(false);
    expect(replicaResetRequired(hindsightCursorResetFailure(body("cursor_expired")))).toBe(true);
  });

  it("keeps a rollback only for the checkpoint's own lineage and generation", () => {
    const rollback = hindsightCursorResetFailure(body("cursor_ahead"));
    expect(confirmHindsightRollback(rollback, { providerLineageId: LINEAGE, bankGeneration: GENERATION })).toBe(rollback);
    for (const expected of [{ providerLineageId: OTHER, bankGeneration: GENERATION }, { providerLineageId: LINEAGE, bankGeneration: OTHER }]) {
      expect(confirmHindsightRollback(rollback, expected)).toMatchObject({ code: "HINDSIGHT_CURSOR_RESET_REQUIRED" });
    }
    const unrelated = hindsightError("HINDSIGHT_TIMEOUT");
    expect(confirmHindsightRollback(unrelated, { providerLineageId: OTHER, bankGeneration: OTHER })).toBe(unrelated);
  });
});
