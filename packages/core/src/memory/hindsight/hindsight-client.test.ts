import { describe, expect, it, vi } from "vitest";
import { createHindsightClient, type HindsightTransport } from "./hindsight-client.ts";

const key = "hindsight-test-secret";
const manifest = {
  base_api_version: "0.9.0", compatibility_version: "1.0.0",
  source_identity: { upstream_commit: "abc", compatibility_build: "taki-memory-hindsight-0.9.0-batch0-v2" },
  provider: { lineage: "11111111-1111-4111-8111-111111111111", database_dialect: "postgresql", storage_mode: "sql_rows" },
  support: { state: "supported", reason: "all_contracts_available" },
  journal: { schema_version: 1, retention_mode: "operator_managed_cursor_floor", cursor_reset_supported: true },
  snapshot: { schema_version: 1, default_page_size: 1, max_page_size: 10, default_ttl_seconds: 60, max_ttl_seconds: 120 },
  contracts: Object.fromEntries(["change_journal", "conditional_mutation", "logical_snapshot", "additive_observation_instructions", "controlled_layer_projection"].map((name) => [name, { version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" } }])),
};

function client(transport: HindsightTransport, resolveApiKey: () => string | null = () => key) {
  return createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey, transport });
}
const context = { timeoutMs: 1_000 };

describe("Hindsight client", () => {
  it.each(["deadline", "caller"])("preserves the first %s when transport settles after both abort signals", async (first) => {
    vi.useFakeTimers();
    try {
      for (const settle of ["resolve", "reject"]) {
        const caller = new AbortController();
        const transport: HindsightTransport = async () => new Promise((resolve, reject) => {
          setTimeout(() => settle === "resolve" ? resolve({ status: 200, body: '{"status":"healthy","database":"connected"}' })
            : reject(new Error("private late provider failure")), 100);
        });
        setTimeout(() => caller.abort("private caller reason"), first === "caller" ? 10 : 30);
        const call = client(transport).health({ timeoutMs: 20, signal: caller.signal });
        const settled = call.catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(100);
        expect(await settled).toMatchObject({ code: first === "caller" ? "HINDSIGHT_CANCELLED" : "HINDSIGHT_TIMEOUT" });
        expect(JSON.stringify(await settled)).not.toContain("private");
      }
    } finally { vi.useRealTimers(); }
  });

  it("sends Bearer authentication on every read-only connection check", async () => {
    const transport = vi.fn<HindsightTransport>(async () => ({ status: 200, body: JSON.stringify(manifest) }));
    await client(transport).compatibility(context);
    expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${key}` });
  });

  it("refuses a missing key before calling transport", async () => {
    const transport = vi.fn<HindsightTransport>();
    await expect(client(transport, () => null).health(context)).rejects.toMatchObject({ code: "HINDSIGHT_SECRET_UNAVAILABLE" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("isolates the known OpenAPI template body exception with dry_run", async () => {
    const transport = vi.fn<HindsightTransport>(async () => ({ status: 200, body: JSON.stringify({ bank_id: "b", config_applied: true, dry_run: true }) }));
    await client(transport).importTemplate({ bankId: "b", template: { version: "1", directives: [{ name: "taki", content: "only owned" }] }, dryRun: true, context });
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(String(url)).toContain("/import?dry_run=true");
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(String(init?.body)).toContain("only owned");
  });

  it("maps auth and malformed response failures without leaking the key", async () => {
    const unauthorized = async () => ({ status: 401, body: '{"detail":"bad"}' });
    await expect(client(unauthorized).health(context)).rejects.toMatchObject({ code: "HINDSIGHT_AUTHENTICATION_FAILED" });
    const broken = async () => ({ status: 200, body: "<html>provider said no</html>" });
    await expect(client(broken).health(context)).rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
  });

  it("normalizes status-only LLM health without provider configuration", async () => {
    const transport = async () => ({ status: 200, body: JSON.stringify({ bank_id: "b", operations: [{ operation: "retain", ok: true, status: "connected", latency_ms: 1 }] }) });
    await expect(client(transport).bankLlmHealth("b", context)).resolves.toEqual({ bankId: "b", operations: [{ operation: "retain", ok: true, status: "connected", latencyMs: 1 }] });
  });

  it("polls operation status without including unstable result metadata", async () => {
    const transport = async () => ({ status: 200, body: JSON.stringify({ operation_id: "op-1", status: "completed", result_metadata: { private: "ignored" } }) });
    await expect(client(transport).operationStatus("b", "op-1", context)).resolves.toEqual({ operationId: "op-1", status: "completed" });
  });

  it("uses the exact deterministic operation id for async retain imports", async () => {
    const operationId = "550e8400-e29b-51d4-a716-446655440000";
    const transport = vi.fn<HindsightTransport>(async () => ({ status: 200, body: JSON.stringify({ success: true, bank_id: "bank", items_count: 1, async: true, operation_id: operationId }) }));
    await expect(client(transport).retainImport?.({ bankId: "bank", content: "safe source", documentId: "doc", operationId, context: null, call: context })).resolves.toEqual({ operationId, itemsCount: 1 });
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toMatchObject({ async: true, operation_id: operationId, items: [{ document_id: "doc", content: "safe source" }] });
  });

  it("projects only retain completion counts and pages document facts", async () => {
    const operation = vi.fn<HindsightTransport>(async () => ({ status: 200, body: JSON.stringify({ operation_id: "op", status: "completed", result_metadata: { unit_ids_count: 2, extraction_errors_count: 0, private: "not returned" } }) }));
    await expect(client(operation).operationImportStatus?.("bank", "op", context)).resolves.toMatchObject({ operationId: "op", status: "completed", derivedUnitCount: 2, extractionErrorCount: 0 });
    expect(await client(operation).operationImportStatus?.("bank", "op", context)).not.toHaveProperty("result_metadata");
    const pageTransport = vi.fn<HindsightTransport>(async () => ({ status: 200, body: JSON.stringify({ items: [{ id: "fact", document_id: "doc", revision: 1 }], total: 1, limit: 100, offset: 0 }) }));
    await expect(client(pageTransport).factPage?.({ bankId: "bank", documentId: "doc", limit: 100, offset: 0, context })).resolves.toMatchObject({ total: 1, items: [{ id: "fact" }] });
    expect(String(pageTransport.mock.calls[0]?.[0])).toContain("document_id=doc");
  });

  it("creates and reads authenticated cursor-bound logical snapshots", async () => {
    const snapshotId = "33333333-3333-4333-8333-333333333333";
    const lineage = "11111111-1111-4111-8111-111111111111";
    const generation = "22222222-2222-4222-8222-222222222222";
    const hash = "a".repeat(64);
    const snapshot = { snapshot_id: snapshotId, manifest: { schema_version: 1, bank_id: "bank", provider_lineage: lineage,
      bank_generation: generation, end_cursor: 7, page_size: 1, total_pages: 1, total_records: 1,
      counts: { bank: 1, document: 0, memory_unit: { valid: 0, invalidated: 0 }, mental_model: 0, directive: 0, total: 1 },
      page_hashes: [hash], sha256: hash }, created_at: "2026-08-21T00:00:00.000Z", expires_at: "2026-08-21T01:00:00.000Z" };
    const page = { snapshot_id: snapshotId, page_number: 0, total_pages: 1, record_count: 1, content_sha256: hash,
      records: [{ object_kind: "bank", object_id: "bank", object_revision: 1, payload: { bank_id: "bank", name: "Global",
        disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {},
        created_at: "2026-08-21T00:00:00.000Z", updated_at: "2026-08-21T00:00:00.000Z" } }] };
    const transport = vi.fn<HindsightTransport>(async (url) => String(url).includes("/pages/0")
      ? { status: 200, body: JSON.stringify(page) } : { status: 201, body: JSON.stringify(snapshot) });
    const snapshotClient = client(transport);
    await expect(snapshotClient.createLogicalSnapshot?.({ bankId: "bank", pageSize: 1, ttlSeconds: 60, context })).resolves.toMatchObject({ snapshotId, manifest: { endCursor: 7 } });
    await expect(snapshotClient.logicalSnapshot?.("bank", snapshotId, context)).resolves.toMatchObject({ manifest: { bankGeneration: generation } });
    await expect(snapshotClient.logicalSnapshotPage?.({ bankId: "bank", snapshotId, pageNumber: 0, context })).resolves.toMatchObject({
      pageNumber: 0, records: [{ objectKind: "bank", payload: { value: { bankId: "bank" } } }],
    });
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({ page_size: 1, ttl_seconds: 60 });
    expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${key}` });
  });

  it("maps snapshot expiry, missing page, cursor reset, and integrity failures", async () => {
    const statuses = [410, 404, 409, 500] as const;
    const codes = ["HINDSIGHT_SNAPSHOT_EXPIRED", "HINDSIGHT_SNAPSHOT_PAGE_MISSING",
      "HINDSIGHT_CURSOR_RESET_REQUIRED", "HINDSIGHT_SNAPSHOT_INTEGRITY"];
    for (const [index, status] of statuses.entries()) {
      const snapshotClient = client(async () => ({ status, body: "{}" }));
      await expect(snapshotClient.logicalSnapshotPage?.({ bankId: "bank", snapshotId: "snapshot", pageNumber: 0, context }))
        .rejects.toMatchObject({ code: codes[index] });
    }
  });

  it("maps retain operation-id conflicts as non-retryable identity failures", async () => {
    const snapshotClient = client(async () => ({ status: 409, body: "{}" }));
    await expect(snapshotClient.retainImport?.({ bankId: "bank", content: "safe", documentId: "document",
      operationId: "operation", context: null, call: context })).rejects.toMatchObject({
        code: "HINDSIGHT_OPERATION_IDENTITY_CONFLICT", retryable: false,
      });
  });

  it("reads authenticated complete journal pages without treating an empty page as progress", async () => {
    const lineage = "11111111-1111-4111-8111-111111111111";
    const generation = "22222222-2222-4222-8222-222222222222";
    const transport = vi.fn<HindsightTransport>(async () => ({ status: 200, body: JSON.stringify({
      provider_lineage: lineage, bank_generation: generation, from_cursor: 7, next_cursor: 7,
      current_cursor: 7, minimum_available_cursor: 0, has_more: false, changes: [],
    }) }));
    const result = await client(transport).changesAfter?.({ bankId: "bank", afterCursor: 7, limit: 500, context });
    expect(result).toMatchObject({ bankId: "bank", predecessorCursor: 7, nextCursor: 7, changes: [] });
    expect(String(transport.mock.calls[0]?.[0])).toContain("/changes?after_cursor=7&limit=500");
    expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${key}` });
  });

  it("maps journal cursor reset and partial/oversized batches into safe failures", async () => {
    await expect(client(async () => ({ status: 409, body: "private cursor details" })).changesAfter?.({
      bankId: "bank", afterCursor: 7, limit: 500, context,
    })).rejects.toMatchObject({ code: "HINDSIGHT_CURSOR_RESET_REQUIRED" });
    const change = { cursor: 8, provider_lineage: "11111111-1111-4111-8111-111111111111",
      bank_generation: "22222222-2222-4222-8222-222222222222", batch_id: "33333333-3333-4333-8333-333333333333",
      batch_index: 0, batch_size: 2, object_kind: "memory_unit", object_id: "memory", object_revision: 2,
      operation: "tombstone", payload: null, recorded_at: "2026-09-05T00:00:00.000Z" };
    const page = { provider_lineage: change.provider_lineage, bank_generation: change.bank_generation,
      from_cursor: 7, next_cursor: 8, current_cursor: 9, minimum_available_cursor: 0, has_more: true, changes: [change] };
    for (const batchSize of [2, 10_001]) {
      const transport = async () => ({ status: 200, body: JSON.stringify({ ...page, changes: [{ ...change, batch_size: batchSize }] }) });
      await expect(client(transport).changesAfter?.({ bankId: "bank", afterCursor: 7, limit: 500, context }))
        .rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID", message: expect.not.stringContaining("private") });
    }
  });

  it("refuses malformed journal lineage and cursor windows at the client boundary", async () => {
    const change = { cursor: 8, provider_lineage: "11111111-1111-4111-8111-111111111111",
      bank_generation: "22222222-2222-4222-8222-222222222222", batch_id: "33333333-3333-4333-8333-333333333333",
      batch_index: 0, batch_size: 1, object_kind: "memory_unit", object_id: "memory", object_revision: 2,
      operation: "tombstone", payload: null, recorded_at: "2026-09-05T00:00:00.000Z" };
    const page = { provider_lineage: change.provider_lineage, bank_generation: change.bank_generation,
      from_cursor: 7, next_cursor: 8, current_cursor: 8, minimum_available_cursor: 0, has_more: false, changes: [change] };
    for (const invalid of [{ ...page, minimum_available_cursor: 8 }, { ...page, current_cursor: 7 },
      { ...page, next_cursor: 7, has_more: true, changes: [] },
      { ...page, changes: [{ ...change, provider_lineage: change.batch_id }] }]) {
      await expect(client(async () => ({ status: 200, body: JSON.stringify(invalid) })).changesAfter?.({
        bankId: "bank", afterCursor: 7, limit: 500, context,
      })).rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    }
  });

  it("preserves nested JSON keys and refuses ambiguous snake/camel payload identities", async () => {
    const payload = { bank_id: "bank", directive_id: "d", name: "fixture", content: "fixture content",
      priority: 1, is_active: true, tags: [], created_at: "2026-09-05T00:00:00.000Z", updated_at: "2026-09-05T00:00:00.000Z" };
    const change = { cursor: 8, provider_lineage: "11111111-1111-4111-8111-111111111111",
      bank_generation: "22222222-2222-4222-8222-222222222222", batch_id: "33333333-3333-4333-8333-333333333333",
      batch_index: 0, batch_size: 1, object_kind: "directive", object_id: "d", object_revision: 2,
      operation: "upsert", payload, recorded_at: "2026-09-05T00:00:00.000Z" };
    const page = { provider_lineage: change.provider_lineage, bank_generation: change.bank_generation,
      from_cursor: 7, next_cursor: 8, current_cursor: 8, minimum_available_cursor: 0, has_more: false, changes: [change] };
    const transport = async () => ({ status: 200, body: JSON.stringify({ ...page,
      changes: [{ ...change, payload: { ...payload, directive_id: "wrong", directiveId: "d" } }] }) });
    await expect(client(transport).changesAfter?.({ bankId: "bank", afterCursor: 7, limit: 500, context }))
      .rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    const bank = { bank_id: "bank", name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 },
      mission: "fixture", config: { reflect_options: { source_query: "kept" } },
      created_at: payload.created_at, updated_at: payload.updated_at };
    await expect(client(async () => ({ status: 200, body: JSON.stringify({ ...page,
      changes: [{ ...change, object_kind: "bank", object_id: "bank", payload: bank }] }) }))
      .changesAfter?.({ bankId: "bank", afterCursor: 7, limit: 500, context }))
      .resolves.toMatchObject({ changes: [{ payload: { value: { config: bank.config } } }] });
  });
});
