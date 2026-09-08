import { afterEach, describe, expect, it, vi } from "vitest";
import type { MutationRequest, RetainRequest } from "@taki/shared";
import { createHindsightClient, type HindsightTransport } from "./hindsight-client.ts";

const memoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const operationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const at = "2026-09-06T00:00:00.000Z";
const context = { timeoutMs: 1000 };
const edit: MutationRequest = { kind: "edit", bankId: "bank", memoryId, expectedRevision: 2,
  patch: { text: "corrected fact", context: null, occurredStart: null, occurredEnd: null, entities: ["Alice"] } };
afterEach(() => { vi.restoreAllMocks(); });
function client(transport?: HindsightTransport) {
  return createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "dummy-key", transport });
}
function native(overrides: Record<string, unknown> = {}) {
  return { id: memoryId, revision: 3, state: "valid", text: "corrected fact", entities: ["Alice"], ...overrides };
}

describe("Pending Memory native client contracts", () => {
  it("uses the actual native retain field formats and keeps policy/provenance out of the provider request", async () => {
    const transport = vi.fn<HindsightTransport>(async () => ({ status: 200,
      body: JSON.stringify({ success: true, async: true, bank_id: "bank", items_count: 1, operation_id: operationId }) }));
    await client(transport).retainPending!({ request: retain(), operationId, documentId: "frozen-document", originalAt: at, context });
    const init = transport.mock.calls[0]![1]!;
    expect(init.headers).toMatchObject({ authorization: "Bearer dummy-key" });
    expect(JSON.parse(String(init.body))).toEqual({ async: true, operation_id: operationId, items: [{ content: "timeless content",
      document_id: "frozen-document", timestamp: "unset", context: null, tags: [], entities: [{ text: "Alice" }],
      metadata: { number: "4", object: '{"nested":true}' }, observation_scopes: "shared", strategy: null, update_mode: "replace" }] });
    expect(String(init.body)).not.toContain("sanitized"); expect(String(init.body)).not.toContain("policyVersion");
  });

  it("maps nullable curation fields to the source-backed clearing semantics and includes both CAS identities", async () => {
    const transport = vi.fn<HindsightTransport>(async () => ({ status: 200, body: JSON.stringify(native()) }));
    const result = await client(transport).mutatePending!({ request: edit, operationId, context });
    expect(result).toMatchObject({ outcome: "accepted", memoryId, revision: 3, changed: true });
    expect(JSON.parse(String(transport.mock.calls[0]![1]!.body))).toEqual({ expected_revision: 2, mutation_id: operationId,
      text: "corrected fact", context: "", occurred_start: null, occurred_end: null, entities: ["Alice"] });
  });

  it("distinguishes an idempotent no-op receipt from an applied revision", async () => {
    const transport: HindsightTransport = async () => ({ status: 200, body: JSON.stringify(native({ revision: 2 })) });
    await expect(client(transport).mutatePending!({ request: { kind: "restore", bankId: "bank", memoryId, expectedRevision: 2 }, operationId, context }))
      .resolves.toMatchObject({ outcome: "accepted", changed: false, revision: 2 });
  });

  it("validates typed stale revision and identity conflicts instead of treating all 409/412 errors alike", async () => {
    const stale: HindsightTransport = async () => ({ status: 412, body: JSON.stringify({ error: "memory_revision_mismatch",
      memory_id: memoryId, expected_revision: 2, current_revision: 4 }) });
    await expect(client(stale).mutatePending!({ request: edit, operationId, context })).resolves.toEqual({ outcome: "superseded", currentRevision: 4 });
    const conflicting: HindsightTransport = async () => ({ status: 409, body: JSON.stringify({ error: "memory_mutation_id_conflict", memory_id: memoryId, mutation_id: operationId }) });
    await expect(client(conflicting).mutatePending!({ request: edit, operationId, context })).resolves.toEqual({ outcome: "identity_conflict" });
    const missing: HindsightTransport = async () => ({ status: 404, body: "" });
    await expect(client(missing).mutatePending!({ request: edit, operationId, context })).resolves.toEqual({ outcome: "superseded", currentRevision: null });
  });

  it.each([
    { status: 200, body: native({ id: otherId }) },
    { status: 200, body: native({ revision: 4 }) },
    { status: 412, body: { error: "memory_revision_mismatch", memory_id: otherId, expected_revision: 2, current_revision: 4 } },
    { status: 412, body: { error: "memory_revision_mismatch", memory_id: memoryId, expected_revision: 1, current_revision: 4 } },
    { status: 409, body: { error: "memory_mutation_id_conflict", memory_id: memoryId, mutation_id: otherId } },
  ])("refuses a receipt belonging to different work: $status", async (response) => {
    const transport: HindsightTransport = async () => ({ status: response.status, body: JSON.stringify(response.body) });
    await expect(client(transport).mutatePending!({ request: edit, operationId, context })).rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
  });

  it("rejects cancellation before transport and after an ignored abort without acknowledging the mutation", async () => {
    const cancelled = new AbortController(); cancelled.abort();
    const transport = vi.fn<HindsightTransport>();
    await expect(client(transport).mutatePending!({ request: edit, operationId, context: { ...context, signal: cancelled.signal } })).rejects.toMatchObject({ code: "HINDSIGHT_CANCELLED" });
    expect(transport).not.toHaveBeenCalled();
    const controller = new AbortController();
    const late: HindsightTransport = async () => { controller.abort(); return { status: 200, body: JSON.stringify(native()) }; };
    await expect(client(late).mutatePending!({ request: edit, operationId, context: { ...context, signal: controller.signal } })).rejects.toMatchObject({ code: "HINDSIGHT_CANCELLED" });
  });

  it("cancels an oversized streamed conditional-error body before buffering its remainder", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 1)); }, cancel });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 412 }));
    await expect(client().mutatePending!({ request: edit, operationId, context })).rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

function retain(): RetainRequest {
  return { bankId: "bank", content: "timeless content", context: null, timestamp: "unset", tags: [], entities: ["Alice"],
    metadata: { number: 4, object: { nested: true } }, observationScopes: "shared", documentId: null, strategy: null, updateMode: "replace",
    provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: null, timelineToSeq: null,
      capturedAt: at, sanitized: true, sourceRef: null }, policy: { layerId: "profile", importance: 5, visibility: "retrieved",
      disclosure: null, origin: "self", emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1 } };
}
