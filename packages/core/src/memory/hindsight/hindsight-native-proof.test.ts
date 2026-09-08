import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HindsightNativeResultPageSchema, HindsightNativeResultSchema, PendingMemoryRecordSchema,
  nativeProofJson, nativeReferenceFields, nativeResultFields, nativeReceiptFields,
  type HindsightNativeResultPage, type PendingMemoryRecord } from "@taki/shared";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { createHindsightClient } from "./hindsight-client.ts";
import { assertNativeResultBinding, nativeProofHash, prepareTrackedDispatch, verifyNativeResultPages } from "./hindsight-native-proof.ts";

const at = "2026-09-08T00:00:00.000Z";
const identity = { contract_version: "1.0.0" as const, operation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  provider_lineage: "11111111-1111-4111-8111-111111111111", bank_generation: "22222222-2222-4222-8222-222222222222" };

describe("native factual proof verification", () => {
  it("verifies every page above the legacy 256-ref cap and returns only compact evidence", async () => {
    const f = fixture(300); const calls: number[] = [];
    const proof = await f.verify((number) => { calls.push(number); return f.pages[number]!; });
    expect(calls).toEqual([0, 1, 2]); expect(proof.result.manifest.total_records).toBe(300);
    expect(JSON.stringify(proof).length).toBeLessThan(4_000);
    expect(proof.result.inputs[0]?.created_count).toBe(1);
  });

  it.each(["missing", "order", "page_hash", "ordinal", "document", "revision", "count"] as const)("rejects %s page corruption", async (kind) => {
    const f = fixture(300);
    await expect(f.verify((number) => {
      if (kind === "missing" && number === 1) throw new Error("HINDSIGHT_NATIVE_RESULT_UNAVAILABLE");
      const page = structuredClone(f.pages[kind === "order" && number === 1 ? 0 : number]!);
      if (number !== 1) return page;
      if (kind === "page_hash") page.page_sha256 = "0".repeat(64);
      if (kind === "ordinal") page.references[0]!.ordinal -= 1;
      if (kind === "document") page.references[0]!.document_id = "foreign-source";
      if (kind === "revision") page.references[0]!.revision += 1;
      if (kind === "count") page.references.pop();
      return page;
    })).rejects.toThrow(/HINDSIGHT_(NATIVE_RESULT|UNREACHABLE)/);
  });

  it("rejects duplicate UUIDs even when case changes and all supplied digests agree", async () => {
    const f = fixture(2, true);
    await expect(f.verify()).rejects.toThrow("HINDSIGHT_NATIVE_RESULT_INVALID");
  });

  it("refuses result or dispatch identity tampering before any page request", () => {
    const f = fixture(1);
    for (const field of ["bank_id", "request_hash", "result_hash", "native_receipt_hash"] as const) {
      const result = { ...f.result, [field]: field === "bank_id" ? "other" : "0".repeat(64) };
      expect(() => assertNativeResultBinding(f.record, result)).toThrow("HINDSIGHT_NATIVE_RESULT_INVALID");
    }
    const stale = structuredClone(f.record); stale.intent.baseCursor = f.result.native_through_cursor + 1;
    expect(() => assertNativeResultBinding(stale, f.result)).toThrow("HINDSIGHT_NATIVE_RESULT_INVALID");
  });

  it("keeps zero-result proof explicit and preserves request/response byte bounds", async () => {
    const empty = fixture(0); let calls = 0;
    const proof = await empty.verify(() => { calls += 1; throw new Error("zero has no pages"); });
    expect(calls).toBe(0); expect(proof.result.manifest.total_records).toBe(0);
    const large = record();
    if (large.intent.operation.kind !== "retain") throw new Error("fixture kind");
    large.intent.operation.request.metadata = { value: "界".repeat(200_000) };
    expect(() => prepareTrackedDispatch(large, null)).toThrow("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
    const f = fixture(1);
    await expect(f.verify(undefined, true)).rejects.toThrow("HINDSIGHT_RESPONSE_INVALID");
  });
});

function fixture(count: number, duplicate = false) {
  const row = record();
  const references = Array.from({ length: count }, (_, ordinal) => ({ ordinal, input_index: 0, document_id: "source",
    memory_id: `aaaaaaaa-aaaa-4aaa-8aaa-${ordinal.toString(16).padStart(12, "0")}`, revision: ordinal + 1,
    state: ordinal % 5 === 0 ? "invalidated" as const : "valid" as const }));
  if (duplicate) references[1]!.memory_id = references[0]!.memory_id.toUpperCase();
  const digest = createHash("sha256").update("taki-native-references.v1\n");
  for (const ref of references) digest.update(`${nativeProofJson(nativeReferenceFields(ref))}\n`);
  const result = HindsightNativeResultSchema.parse({ ...identity, bank_id: "global", operation_kind: "retain",
    request_hash: row.dispatch?.protocol === "tracked_native_v1" ? row.dispatch.requestHash : "", native_outcome: "applied", native_through_cursor: 2,
    inputs: [{ input_index: 0, document_id: "source", update_mode: "append", prepared_input_hash: "a".repeat(64),
      document_hash: "b".repeat(64), created_count: count > 0 ? 1 : 0, full_result_count: count, first_ordinal: 0 }], mutation: null,
    manifest: { total_records: count, page_size: 128, total_pages: Math.ceil(count / 128), references_sha256: digest.digest("hex") },
    result_hash: "0".repeat(64), native_receipt_hash: "0".repeat(64) });
  result.result_hash = nativeProofHash(nativeResultFields(result)); result.native_receipt_hash = nativeProofHash(nativeReceiptFields(result));
  const pages = Array.from({ length: result.manifest.total_pages }, (_, page_number) => {
    const pageRefs = references.slice(page_number * 128, (page_number + 1) * 128);
    return HindsightNativeResultPageSchema.parse({ ...identity, bank_id: "global", operation_kind: "retain", result_hash: result.result_hash,
      page_number, first_ordinal: page_number * 128, references: pageRefs,
      page_sha256: nativeProofHash(["taki-native-page.v1", result.result_hash, page_number, pageRefs.map(nativeReferenceFields)]) });
  });
  return { record: row, result, pages, verify: (page = (number: number): HindsightNativeResultPage => pages[number]!, oversized = false) => {
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:9", resolveApiKey: () => "offline-only", transport: async (url) => ({
      status: 200, body: JSON.stringify(page(Number(new URL(url).pathname.split("/").at(-1)))) + (oversized ? " ".repeat(512 * 1024) : ""),
    }) });
    return verifyNativeResultPages({ record: row, result, client, request: () => ({ timeoutMs: 1000 }), now: () => at });
  } };
}

function record(): PendingMemoryRecord {
  const intent = { schemaVersion: 1, authorityEpochId: "epoch", providerId: "hindsight", providerLineageId: identity.provider_lineage,
    bankGeneration: identity.bank_generation, bank: { bankId: "global", scope: "global", characterId: null },
    operationId: "fixture", originalAt: at, baseCursor: 1,
    operation: { kind: "retain", zeroResultAllowed: true, request: { bankId: "global", content: "fragment", context: null,
      timestamp: null, tags: [], entities: [], metadata: {}, observationScopes: null, documentId: "source", strategy: null, updateMode: "append",
      provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: null, timelineToSeq: null,
        capturedAt: at, sanitized: true, sourceRef: null },
      policy: { layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null, origin: "self", emotionalWeight: null,
        retention: { kind: "permanent" }, policyVersion: 1 } } } };
  const row = PendingMemoryRecordSchema.parse({ sequence: 1, intent, intentHash: canonicalPayloadHash(intent), remoteOperationId: identity.operation_id,
    documentId: "source", preparedMutation: null, preparedMutationHash: null, phase: "submitted", version: 1, attempts: 1,
    lastAttemptAt: at, nextRetryAt: null, dispatchedAt: at, acceptedAt: at, nativeReceipt: null, derivedEvidence: null,
    lease: null, diagnosticCode: null, currentRevision: null, createdAt: at, updatedAt: at, terminalAt: null });
  row.dispatch = prepareTrackedDispatch(row, null); return row;
}
