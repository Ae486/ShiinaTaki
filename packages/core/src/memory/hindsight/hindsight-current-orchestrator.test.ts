import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { currentStateFixture, currentImportFixture } from "../../db/hindsight-current-fixtures.ts";
import { createHindsightClient } from "./hindsight-client.ts";
import { importHindsightCurrentBank } from "./hindsight-current-orchestrator.ts";
import type { HindsightCurrentStateClient } from "./hindsight-current-client.ts";
import { withHindsightHttpServer, withOpenHindsightResponse } from "../../testing/hindsight-http-test-fixture.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("current-state HTTP consumer", () => {
  it("recovers a lost write acknowledgement using the exact persisted operation without re-extraction or a second POST", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
    const fixture = currentStateFixture(db); const prepared = fixture.prepare();
    const native = currentImportFixture(prepared, fixture.baselineRecords); let committed = false; let posts = 0;
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "fixture-key", transport: async (url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-key");
      const path = new URL(url).pathname;
      expect(path).toContain("/current-state-transfers");
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual(prepared.request); committed = true; posts++;
        throw new Error("lost ACK");
      }
      if (!committed) return { status: 404, body: JSON.stringify({ error: "current_state_transfer_refused", reason: "result_not_found" }) };
      return { status: 200, body: JSON.stringify(path.includes("/mappings/") ? native.pages[0] : native.result) };
    } }) as HindsightCurrentStateClient;
    const input = { db, preparationId: prepared.preparationId, client, context: { timeoutMs: 1000 } };
    await expect(importHindsightCurrentBank(input)).rejects.toThrow();
    expect(posts).toBe(1);
    const evidence = await importHindsightCurrentBank(input);
    expect(evidence.mappings).toEqual(native.pages[0]?.mappings); expect(posts).toBe(1);
    expect(await importHindsightCurrentBank(input)).toEqual(evidence); expect(posts).toBe(1);
  });

  it("limits old snapshot calls to 512 KiB and gives only the D78 path its explicit 16 MiB budget", async () => {
    const metadata = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`key${index}`, "x".repeat(10_000)]));
    const page = { snapshot_id: "11111111-1111-4111-8111-111111111111", page_number: 0, total_pages: 1,
      record_count: 1, content_sha256: "a".repeat(64), records: [{ object_kind: "document", object_id: "doc", object_revision: 1,
        payload: { bank_id: "bank", document_id: "doc", content_hash: null, tags: [], metadata, observation_scopes: null,
          created_at: "2026-09-08T00:00:00Z", updated_at: "2026-09-08T00:00:00Z" } }] };
    const budgets: Array<number | undefined> = [];
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "fixture-key",
      transport: async (_url, _init, budget) => { budgets.push(budget); return { status: 200, body: JSON.stringify(page) }; } });
    const input = { bankId: "bank", snapshotId: page.snapshot_id, pageNumber: 0, context: { timeoutMs: 1000 } };
    await expect(client.logicalSnapshotPage!(input)).rejects.toThrow();
    expect((await client.currentSnapshotPage!(input)).records[0]?.payload.metadata).toEqual(metadata);
    expect(budgets).toEqual([undefined, 16 * 1024 * 1024]);
  });

  it.each([[403, "operation_refused"], [413, "request_too_large"], [503, "unsupported_storage"]] as const)("preserves the declared native %s/%s envelope through the real bounded HTTP transport", async (status, reason) => {
      const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
      const f = currentStateFixture(db); const prepared = f.prepare();
      const body = { error: "current_state_transfer_refused", reason };
      const requests: Array<{ authorization: string | undefined; method: string | undefined }> = [];
      await withHindsightHttpServer({ handle: (request, response) => {
        requests.push({ authorization: request.headers.authorization, method: request.method });
        request.resume();
        response.writeHead(status); response.end(JSON.stringify(body));
      }, run: async (endpoint) => {
        const client = createHindsightClient({ endpoint, resolveApiKey: () => "fixture-key" });
        await expect(client.transferCurrentState!({ bankId: prepared.bankId, request: prepared.request!, context: { timeoutMs: 1000 } }))
          .resolves.toEqual(body);
        expect(requests).toEqual([{ authorization: "Bearer fixture-key", method: "POST" }]);
      } });
    });

  it.each([[403, "HINDSIGHT_AUTHENTICATION_FAILED"], [503, "HINDSIGHT_UNREACHABLE"]] as const)("keeps undeclared %s bodies classified as %s", async (status, code) => {
      let requests = 0;
      await withHindsightHttpServer({ handle: (_request, response) => {
        requests++; response.writeHead(status); response.end(JSON.stringify({ detail: "private unavailable reason" }));
      }, run: async (endpoint) => {
        const client = createHindsightClient({ endpoint, resolveApiKey: () => "fixture-key" });
        const failure = await client.currentTransferResult!({ bankId: "bank", operationId: "operation", providerLineage: "lineage",
          bankGeneration: "generation", context: { timeoutMs: 1000 } }).catch((error: unknown) => error);
        expect(failure).toMatchObject({ code });
        expect(JSON.stringify(failure)).not.toContain("private unavailable reason");
        expect(requests).toBe(1);
      } });
    });

  it("cancels oversized declared failure bodies before parsing their native envelope", async () => {
    await withOpenHindsightResponse({ status: 503, chunks: [new Uint8Array(512 * 1024 + 1)], run: async (endpoint, response) => {
      const client = createHindsightClient({ endpoint, resolveApiKey: () => "fixture-key" });
      await expect(client.currentTransferResult!({ bankId: "bank", operationId: "operation", providerLineage: "lineage",
        bankGeneration: "generation", context: { timeoutMs: 1000 } })).rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
      await expect.poll(() => response.closes).toBe(1);
      expect(response).toMatchObject({ requests: 1, finishes: 0, bytesOffered: 512 * 1024 + 1 });
    } });
  });
});
