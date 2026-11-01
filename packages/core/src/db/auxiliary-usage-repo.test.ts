import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuxiliaryUsageCounts } from "@taki/shared";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createAuxiliaryUsageRepo, type AuxiliaryUsageRepo } from "./auxiliary-usage-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const from = "2026-11-01T00:00:00.000Z"; const to = "2026-11-02T00:00:00.000Z";
const unknown: AuxiliaryUsageCounts = { inputTokens: null, noCacheTokens: null, cacheReadTokens: null,
  cacheWriteTokens: null, outputTokens: null, reasoningTokens: null, totalTokens: null };

function open(path = ":memory:"): { db: Database; repo: AuxiliaryUsageRepo } {
  const db = openDatabase({ path, migrations: MIGRATIONS }); cleanup.push(() => db.close());
  return { db, repo: createAuxiliaryUsageRepo(db) };
}
function id(value: number): string { return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`; }
function start(repo: AuxiliaryUsageRepo, input: { callId: string; startedAt?: string; source?: "utility" | "image-description" }) {
  const source = input.source ?? "utility";
  repo.start({ callId: input.callId, taskId: source === "utility" ? id(900) : null, source, label: `${source}-label`,
    provider: "deepseek", modelId: "chat", startedAt: input.startedAt ?? "2026-11-01T12:00:00.000Z" });
}
function settle(repo: AuxiliaryUsageRepo, input: { callId: string; usage: AuxiliaryUsageCounts; status?: "completed" | "failed" }) {
  repo.settle({ callId: input.callId, status: input.status ?? "completed", finishedAt: "2026-11-01T12:00:01.000Z",
    usage: input.usage, responseId: `response-${input.callId}` });
}

describe("auxiliary usage repo", () => {
  it("notifies only new committed settlements and reconciliation, with rollback and callback isolation", () => {
    const { db } = open(); const onSettled = vi.fn(() => { throw new Error("optional observer failed"); });
    const repo = createAuxiliaryUsageRepo(db, { onSettled }); start(repo, { callId: id(1) });
    expect(onSettled).not.toHaveBeenCalled();
    expect(() => db.transaction(() => {
      settle(repo, { callId: id(1), usage: unknown }); expect(onSettled).not.toHaveBeenCalled();
      throw new Error("rollback");
    })).toThrow("rollback");
    expect(onSettled).not.toHaveBeenCalled();
    expect(() => settle(repo, { callId: id(1), usage: unknown })).not.toThrow();
    settle(repo, { callId: id(1), usage: unknown }); expect(onSettled).toHaveBeenCalledOnce();
    start(repo, { callId: id(2) }); expect(repo.reconcileInterrupted()).toBe(1);
    expect(repo.reconcileInterrupted()).toBe(0); expect(onSettled).toHaveBeenCalledTimes(2);
  });

  it("persists started calls across reopen and reconciles them only when explicitly requested", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-auxiliary-usage-")); cleanup.push(() => rmTempDir(root));
    const path = join(root, "state.db"); const first = open(path); start(first.repo, { callId: id(1) }); first.db.close();
    const second = open(path);
    expect(second.repo.query({ from, to }).rows[0]?.status).toBe("started");
    expect(second.repo.reconcileInterrupted()).toBe(1);
    expect(second.repo.reconcileInterrupted()).toBe(0);
    const recovered = second.repo.query({ from, to }).rows[0]!;
    expect(recovered).toMatchObject({ status: "interrupted", finishedAt: null, responseId: null, usage: unknown });
    expect(recovered.updatedAt).not.toBe(recovered.startedAt);
  });

  it("preserves explicit zero, unknown counts, and exact start/terminal replays", () => {
    const { db, repo } = open(); start(repo, { callId: id(2) }); start(repo, { callId: id(2) });
    expect(() => repo.start({ callId: id(2), taskId: id(900), source: "utility", label: "changed",
      provider: "deepseek", modelId: "chat", startedAt: "2026-11-01T12:00:00.000Z" })).toThrow("AUXILIARY_USAGE_START_CONFLICT");
    const usage = { ...unknown, inputTokens: 0, cacheReadTokens: 0, totalTokens: 0 };
    settle(repo, { callId: id(2), usage });
    const updatedAt = db.prepare("SELECT updated_at FROM auxiliary_model_calls WHERE call_id=:id").get({ id: id(2) })?.updated_at;
    settle(repo, { callId: id(2), usage });
    expect(db.prepare("SELECT updated_at FROM auxiliary_model_calls WHERE call_id=:id").get({ id: id(2) })?.updated_at).toBe(updatedAt);
    expect(repo.query({ from, to }).rows[0]?.usage).toEqual(usage);
    expect(() => settle(repo, { callId: id(2), usage: { ...usage, totalTokens: 1 } })).toThrow("AUXILIARY_USAGE_SETTLEMENT_CONFLICT");
  });

  it("uses stable newest-first tie paging while aggregating the whole filter", () => {
    const { repo } = open();
    const earlier = "2026-11-01T11:00:00.000Z"; const tied = "2026-11-01T12:00:00.000Z";
    start(repo, { callId: id(1), startedAt: earlier }); settle(repo, { callId: id(1), usage: unknown, status: "failed" });
    start(repo, { callId: id(2), startedAt: tied }); settle(repo, { callId: id(2), usage: { ...unknown, inputTokens: 50 } });
    start(repo, { callId: id(3), startedAt: tied }); settle(repo, { callId: id(3), usage: { ...unknown, inputTokens: 0, cacheReadTokens: 0 } });
    start(repo, { callId: id(4), startedAt: tied }); settle(repo, { callId: id(4), usage: { ...unknown, inputTokens: 100, cacheReadTokens: 70,
      noCacheTokens: 30, outputTokens: 20, reasoningTokens: 5, totalTokens: 120 } });

    const first = repo.query({ from, to, limit: 2 });
    expect(first.rows.map((row) => row.callId)).toEqual([id(4), id(3)]);
    expect(first.nextCursor).toEqual({ startedAt: tied, callId: id(3) });
    expect(first.totalCalls).toBe(4);
    expect(first.stateCounts).toEqual({ started: 0, completed: 3, failed: 1, cancelled: 0, interrupted: 0 });
    expect(first.tokenCounts.inputTokens).toEqual({ sum: 150, knownCount: 3 });
    expect(first.tokenCounts.cacheReadTokens).toEqual({ sum: 70, knownCount: 2 });
    expect(first.tokenCounts.reasoningTokens).toEqual({ sum: 5, knownCount: 1 });
    expect(first.cacheRead).toEqual({ pairedCount: 2, inputTokens: 100, cacheReadTokens: 70, ratio: 0.7 });

    const second = repo.query({ from, to, limit: 2, cursor: first.nextCursor! });
    expect(second.rows.map((row) => row.callId)).toEqual([id(2), id(1)]);
    expect(second.nextCursor).toBeNull();
    expect(second.totalCalls).toBe(4);
  });

  it("applies exact filters to aggregates and treats the upper time bound as exclusive", () => {
    const { repo } = open();
    start(repo, { callId: id(10), startedAt: "2026-11-01T23:59:59.999Z", source: "image-description" });
    start(repo, { callId: id(11), startedAt: to, source: "image-description" });
    start(repo, { callId: id(12), startedAt: "2026-11-01T12:00:00.000Z" });
    const result = repo.query({ from, to, source: "image-description", label: "image-description-label", limit: 1 });
    expect(result.rows.map((row) => row.callId)).toEqual([id(10)]);
    expect(result.totalCalls).toBe(1);
    expect(result.tokenCounts.totalTokens).toEqual({ sum: null, knownCount: 0 });
    expect(result.cacheRead).toEqual({ pairedCount: 0, inputTokens: null, cacheReadTokens: null, ratio: null });
  });

  it("normalizes equivalent timezone offsets before ordering and range comparison", () => {
    const { repo } = open();
    repo.start({ callId: id(20), taskId: null, source: "screenshot-description", label: "offset",
      provider: "deepseek", modelId: "vision", startedAt: "2026-11-01T20:00:00.000+08:00" });
    const result = repo.query({ from: "2026-11-01T11:59:59.000Z", to: "2026-11-01T20:00:01.000+08:00" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.startedAt).toBe("2026-11-01T12:00:00.000Z");
    expect(result.nextCursor).toBeNull();
  });
});
