import { describe, expect, it, vi } from "vitest";
import { hindsightError } from "./hindsight-errors.ts";
import { importHindsightSource } from "./hindsight-import-orchestrator.ts";
import type { HindsightClient } from "./hindsight-client.ts";
import type { FactMapping, HindsightImportLedgerRepo, ImportOperation } from "./hindsight-import-ledger-repo.ts";

const lease = { runId: "run", owner: "owner", fence: 1, expiresAt: "2026-08-21T01:00:00.000Z" };
const source = { lease, sourceId: "source", bankId: "bank", documentId: "doc", operationIdentity: "identity", remoteOperationId: "remote", content: "remember this", contentIdentity: `sha256:${"a".repeat(64)}`, context: null, zeroFactAllowed: false };
const now = "2026-08-21T00:00:00.000Z";

function memoryClient(overrides: Partial<HindsightClient> = {}): HindsightClient {
  const operation = vi.fn(async () => ({ operationId: "remote", status: "completed" as const, resultMetadataHash: "b".repeat(64), derivedUnitCount: 2, extractionErrorCount: 0 }));
  const document = vi.fn(async () => ({ id: "doc", bank_id: "bank", original_text: "remember this", content_hash: "8699bdec86f342226a646ca6d61f17cbb024e26a896384d827f46215c1a4bd70", memory_unit_count: 2 }));
  const factPage = vi.fn(async ({ offset }: { offset: number }) => offset === 0 ? { items: [{ id: "fact-a", document_id: "doc", revision: 1, text: "a" }, { id: "fact-b", document_id: "doc", revision: 2, text: "b" }], total: 2, limit: 100, offset } : { items: [], total: 2, limit: 100, offset });
  return {
    health: vi.fn(), version: vi.fn(), compatibility: vi.fn(), createOrUpdateBank: vi.fn(), importTemplate: vi.fn(), exportTemplate: vi.fn(), bankLlmHealth: vi.fn(), operationStatus: vi.fn(),
    retainImport: vi.fn(async () => ({ operationId: "remote", itemsCount: 1 })), operationImportStatus: operation, document, factPage, ...overrides,
  } as unknown as HindsightClient;
}

function ledger(): { repo: HindsightImportLedgerRepo; state: ImportOperation; mapped: FactMapping[] } {
  const state: ImportOperation = { runId: "run", sourceId: "source", bankId: "bank", documentId: "doc", operationIdentity: "identity", remoteOperationId: "remote", contentIdentity: source.contentIdentity, providerContentHash: "8699bdec86f342226a646ca6d61f17cbb024e26a896384d827f46215c1a4bd70", leaseFence: 1, attemptNo: 0, status: "pending", operationResultHash: null, derivedUnitCount: null, extractionErrorCount: null, mappingComplete: false, zeroFactAllowed: false, diagnosticCode: null, updatedAt: now };
  const mapped: FactMapping[] = [];
  const repo: HindsightImportLedgerRepo = {
    ensureOperation: vi.fn(() => state),
    beginAttempt: vi.fn(() => { state.attemptNo += 1; state.status = "processing"; return state; }),
    markOperation: vi.fn((input) => { Object.assign(state, { status: input.status, operationResultHash: input.resultHash ?? null, derivedUnitCount: input.derivedUnitCount ?? null, extractionErrorCount: input.extractionErrorCount ?? null }); return state; }),
    setMappings: vi.fn((input) => { mapped.splice(0, mapped.length, ...input.mappings); Object.assign(state, { status: "mapped", mappingComplete: true, derivedUnitCount: input.mappings.length }); return state; }),
    read: vi.fn(() => state),
    mappings: vi.fn(() => mapped),
  };
  return { repo, state, mapped };
}

describe("Hindsight import orchestrator", () => {
  it("retries a lost acknowledgement with the exact original operation id and resolves many facts", async () => {
    const calls: string[] = [];
    const client = memoryClient({ retainImport: vi.fn(async (input) => { calls.push(input.operationId); if (calls.length === 1) throw hindsightError("HINDSIGHT_TIMEOUT"); return { operationId: input.operationId, itemsCount: 1 }; }) });
    const fixture = ledger();
    const result = await importHindsightSource(source, { client, ledger: fixture.repo, now: () => now, sleep: async () => undefined, deadlineMs: 1_000 });
    expect(result).toMatchObject({ status: "mapped", mappingComplete: true, derivedUnitCount: 2 });
    expect(calls).toEqual(["remote", "remote"]);
    expect(fixture.mapped).toEqual(expect.arrayContaining([expect.objectContaining({ factId: "fact-a", revision: 1 }), expect.objectContaining({ factId: "fact-b", revision: 2 })]));
  });

  it("treats completed without derived metadata as a blocking failure", async () => {
    const client = memoryClient({ operationImportStatus: vi.fn(async () => ({ operationId: "remote", status: "completed" as const,
      resultMetadataHash: null, derivedUnitCount: null, extractionErrorCount: null })) });
    await expect(importHindsightSource(source, { client, ledger: ledger().repo, now: () => now, deadlineMs: 1_000 })).rejects.toThrow("HINDSIGHT_DERIVED_INCOMPLETE");
  });

  it("rejects an operation status response for a different operation identity", async () => {
    const client = memoryClient({ operationImportStatus: vi.fn(async () => ({
      operationId: "unexpected", status: "completed" as const, resultMetadataHash: "b".repeat(64), derivedUnitCount: 0, extractionErrorCount: 0,
    })) });
    await expect(importHindsightSource({ ...source, zeroFactAllowed: true }, { client, ledger: ledger().repo, now: () => now, deadlineMs: 1_000 }))
      .rejects.toThrow("HINDSIGHT_OPERATION_IDENTITY_CONFLICT");
  });

  it("rejects a document content hash conflict before mapping facts", async () => {
    const client = memoryClient({ document: vi.fn(async () => ({ id: "doc", bank_id: "bank", original_text: "changed", content_hash: "c".repeat(64), memory_unit_count: 1 })) });
    await expect(importHindsightSource({ ...source, zeroFactAllowed: true }, { client, ledger: ledger().repo, now: () => now, deadlineMs: 1_000 })).rejects.toThrow("HINDSIGHT_CONTENT_HASH_CONFLICT");
  });

  it("persists the completed provider receipt before attempting fact resolution", async () => {
    const fixture = ledger(); const client = memoryClient({ document: vi.fn(async () => { throw new Error("document unavailable"); }) });
    await expect(importHindsightSource(source, { client, ledger: fixture.repo, now: () => now, deadlineMs: 1_000 }))
      .rejects.toThrow("document unavailable");
    expect(fixture.state).toMatchObject({ status: "completed", operationResultHash: "b".repeat(64),
      derivedUnitCount: 2, extractionErrorCount: 0 });
  });

  it("stops promptly on cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(importHindsightSource(source, { client: memoryClient(), ledger: ledger().repo, now: () => now, signal: controller.signal, deadlineMs: 1_000 })).rejects.toThrow("HINDSIGHT_CANCELLED");
  });
});
