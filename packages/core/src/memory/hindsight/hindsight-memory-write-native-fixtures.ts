/**
 * INPUT:  real Pending rows and a synthetic D77 Bank with immutable byte events
 * OUTPUT: tracked G1 results/pages plus actual native/application fixture publications
 * POS:    core/memory/hindsight tests only — no network, model, fabricated local Pending completion or production writes
 */
import { createHash } from "node:crypto";
import {
  HindsightNativeResultSchema, HindsightNativeResultPageSchema, HindsightNativeResultStatusSchema,
  nativeProofJson, nativeReferenceFields, nativeResultFields, nativeReceiptFields,
  type HindsightNativeResult, type HindsightNativeResultPage, type PendingMemoryRecord, type TakiApplicationNativePayload,
} from "@taki/shared";
import { APPLICATION_TEST_AT, applicationTestArtifact, applicationTestBody, applicationTestEvent,
  applicationTestMemoryBody, applicationTestMemoryPayload, applicationTestNative, applicationTestSourcePayload,
  type ApplicationArtifactFixture, type ApplicationNativeFixture } from "../../testing/hindsight-application-fixtures.ts";
import { applicationTestBind } from "../../testing/hindsight-application-runtime-fixtures.ts";
import type { PendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import type { CuratorTestBank } from "./hindsight-policy-curator-fixtures.ts";
import type { HindsightClient } from "./hindsight-client.ts";
import { nativeProofHash } from "./hindsight-native-proof.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";

type NativeMethods = Required<Pick<HindsightClient, "trackedNativeWrite" | "nativeResult" | "nativeResultPage">>;
export interface WriteNativeFixtureResult { result: HindsightNativeResult; pages: HindsightNativeResultPage[] }
export function writeNativeFixture(bank: CuratorTestBank, pending: PendingMemoryRepo) {
  const results = new Map<string, WriteNativeFixtureResult>(); const calls: string[] = [];
  const control = { loseAck: false, retainCount: 1, sourceRevision: 7,
    beforeWrite: undefined as ((row: PendingMemoryRecord) => void) | undefined };
  const client: NativeMethods = {
    trackedNativeWrite: async ({ bankId, dispatch }) => {
      if (bankId !== bank.scope.bankId) throw new Error("fixture Bank mismatch");
      const id = dispatch.command.request.operation_id; calls.push(`dispatch:${id}`);
      let saved = results.get(id);
      if (!saved) {
        const row = pending.list({ authorityEpochId: "epoch", bankId, limit: 100 }).find((value) => value.remoteOperationId === id);
        if (!row) throw new Error("fixture Pending row missing");
        control.beforeWrite?.(row);
        const publication = row.intent.operation.kind === "retain"
          ? retainPublication(bank, row, control) : mutationPublication(bank, row);
        saved = proof(row, publication); results.set(id, saved);
      }
      if (control.loseAck) { control.loseAck = false; throw new Error("HINDSIGHT_UNREACHABLE"); }
      return status(saved.result);
    },
    nativeResult: async ({ bankId, identity }) => {
      if (bankId !== bank.scope.bankId) throw new Error("fixture Bank mismatch");
      calls.push(`status:${identity.operation_id}`);
      const saved = results.get(identity.operation_id); if (!saved) throw new Error("fixture native result missing");
      return status(saved.result);
    },
    nativeResultPage: async ({ bankId, identity, pageNumber, resultHash }) => {
      if (bankId !== bank.scope.bankId) throw new Error("fixture Bank mismatch");
      calls.push(`page:${identity.operation_id}:${pageNumber}`);
      const saved = results.get(identity.operation_id);
      if (!saved || saved.result.result_hash !== resultHash || !saved.pages[pageNumber]) throw new Error("fixture native page missing");
      return saved.pages[pageNumber];
    },
  };
  return { client, results, calls, control };
}

interface Publication {
  cursor: number; outcome: "applied" | "unchanged";
  mutation: HindsightNativeResult["mutation"];
  references: HindsightNativeResultPage["references"];
}
function mutationPublication(bank: CuratorTestBank, row: PendingMemoryRecord): Publication {
  const request = row.preparedMutation;
  if (!request) throw new Error("fixture prepared mutation missing");
  const old = bank.native.find((entry) => entry.head.object_id === request.memoryId)!;
  if (old.body.content.body_schema !== "application-native-record.v1" || !("memory_id" in old.body.content.value.payload)) throw new Error("fixture memory missing");
  const current = old.body.content.value.payload;
  let payload = { ...current };
  if (request.kind === "edit") {
    for (const [field, value] of Object.entries(request.patch)) {
      const key = ({ occurredStart: "occurred_start", occurredEnd: "occurred_end", factType: "fact_type" } as Record<string, string>)[field] ?? field;
      payload = { ...payload, [key]: value };
    }
  } else if (request.kind === "invalidate") payload = { ...payload, state: "invalidated", invalidation_reason: request.reason, invalidated_at: APPLICATION_TEST_AT };
  else payload = { ...payload, state: "valid", invalidation_reason: null, invalidated_at: null };
  const changed = !sameApplicationValue(payload, current);
  if (changed) {
    payload = { ...payload, revision: current.revision + 1, edited_at: APPLICATION_TEST_AT };
    publishWriteNativeMemory(bank, payload);
  }
  return { cursor: bank.server.cursor.native, outcome: changed ? "applied" : "unchanged", references: [],
    mutation: { memory_id: payload.memory_id, revision: payload.revision, state: payload.state,
      document_id: payload.document_id, chunk_id: payload.chunk_id } };
}

/** Simulates an external native edit plus its proven rebind, using the same complete event bytes as the app replica. */
export function publishWriteNativeMemory(bank: CuratorTestBank, payload: Extract<TakiApplicationNativePayload, { memory_id: string }>): void {
  const old = bank.artifacts.find((entry) => entry.artifact.key.artifact_kind === "memory" && entry.artifact.key.artifact_id === payload.memory_id)!;
  if (old.body.content.body_schema !== "application-memory.v1") throw new Error("fixture application memory missing");
  const from = { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state };
  const native = applicationTestNative({ scope: bank.scope, kind: "memory_unit", payload, cursor: ++bank.server.cursor.native });
  const body = applicationTestBody("application-memory.v1", { ...old.body.content.value,
    assessment: applicationTestMemoryBody(native.head.version!).assessment }, bank.scope);
  const application = applicationTestArtifact({ scope: bank.scope, key: old.artifact.key, revision: old.artifact.revision + 1,
    body, binding: { kind: "exact_native", native: native.head.version! } });
  publish(bank, { native: [native], artifacts: [application], from });
}

export function publishWriteNativeDeletion(bank: CuratorTestBank, memoryId: string): void {
  const old = bank.native.find((entry) => entry.head.object_id === memoryId)!; const version = old.head.version!;
  const from = { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state };
  const native: ApplicationNativeFixture = { ...old, head: { ...old.head, version: null, body_ref: null,
    bound_artifact: null, binding_state: "tombstoned", previous_version: version, cause: "native_delete",
    tombstone: { object_kind: "memory_unit", object_id: memoryId, object_revision: version.object_revision + 1,
      last_payload_hash: version.payload_hash, native_cursor: ++bank.server.cursor.native } } };
  publish(bank, { native: [native], artifacts: [], from });
}

function retainPublication(bank: CuratorTestBank, row: PendingMemoryRecord, control: { retainCount: number; sourceRevision: number }): Publication {
  const operation = row.intent.operation;
  if (operation.kind !== "retain" || !row.documentId) throw new Error("fixture source intent missing");
  const source = bank.artifacts.find((entry) => entry.artifact.key.artifact_kind === "source"
    && entry.artifact.binding.kind === "awaiting_native" && entry.artifact.binding.operation_id === row.remoteOperationId);
  if (!source || source.body.content.body_schema !== "application-source.v1") throw new Error("source was not preserved before native dispatch");
  const from = { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state };
  const cursor = ++bank.server.cursor.native;
  const original = source.body.content.value.original_source;
  const sourcePayload = applicationTestSourcePayload(bank.scope);
  if (!("document_id" in sourcePayload)) throw new Error("fixture source payload mismatch");
  const document = applicationTestNative({ scope: bank.scope, kind: "document", cursor, revision: control.sourceRevision,
    payload: { ...sourcePayload, document_id: row.documentId, tags: original.tags,
      metadata: source.body.content.value.encoded_metadata ?? {} },
    source: { text: original.retainedText, context: original.context, metadata: original.metadata } });
  const nativeVersion = document.head.version!;
  const sourceBody = applicationTestBody("application-source.v1", { ...source.body.content.value,
    original_witness: { source_kind: "document", source_id: row.documentId,
      source_revision: nativeVersion.object_revision, source_payload_hash: nativeVersion.payload_hash } }, bank.scope);
  const boundSource = applicationTestArtifact({ scope: bank.scope, key: source.artifact.key,
    revision: source.artifact.revision + 1, body: sourceBody, binding: { kind: "exact_native", native: nativeVersion } });
  const units = Array.from({ length: control.retainCount }, (_, index) => {
    const native = applicationTestNative({ scope: bank.scope, kind: "memory_unit", cursor,
      payload: applicationTestMemoryPayload({ bank_id: bank.scope.bankId, memory_id: `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`,
        document_id: row.documentId, text: `Fixture retained fact ${index}`, revision: index + 1 }) });
    const value = applicationTestMemoryBody(native.head.version!);
    value.policy.bankId = bank.scope.bankId; value.provenance.characterId = bank.bankScope.characterId;
    const application = applicationTestArtifact({ scope: bank.scope,
      key: { artifact_kind: "memory", artifact_id: native.head.object_id }, binding: { kind: "exact_native", native: native.head.version! },
      body: applicationTestBody("application-memory.v1", value, bank.scope) });
    return { native, application };
  });
  // Each synthetic fact is part of the same real fixture publication and full body closure, not a fake local row.
  const references = units.map((unit, ordinal) => ({ ordinal, input_index: 0, document_id: row.documentId,
    memory_id: unit.native.head.object_id, revision: ordinal + 1, state: "valid" as const }));
  publish(bank, { native: [document, ...units.map((unit) => unit.native)],
    artifacts: [boundSource, ...units.map((unit) => unit.application)], from });
  return { cursor, outcome: "applied", mutation: null, references };
}

function publish(bank: CuratorTestBank, input: {
  native: ApplicationNativeFixture[]; artifacts: ApplicationArtifactFixture[];
  from: { native_cursor: number; state_cursor: number };
}): void {
  for (const native of input.native) {
    const artifact = input.artifacts.find((entry) => entry.artifact.binding.kind === "exact_native"
      && entry.artifact.binding.native.object_id === native.head.object_id);
    if (artifact) applicationTestBind(native, artifact.artifact);
    bank.native = [...bank.native.filter((entry) => entry.head.object_kind !== native.head.object_kind || entry.head.object_id !== native.head.object_id), native];
  }
  for (const artifact of input.artifacts) bank.artifacts = [...bank.artifacts.filter((entry) => !sameApplicationValue(entry.artifact.key, artifact.artifact.key)), artifact];
  bank.server.cursor.state++;
  bank.events.push(applicationTestEvent({ scope: bank.scope, ...input,
    to: { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state } }));
}

function proof(row: PendingMemoryRecord, publication: Publication): WriteNativeFixtureResult {
  if (row.dispatch?.protocol !== "tracked_native_v1") throw new Error("fixture tracked dispatch missing");
  const identity = { contract_version: "1.0.0" as const, operation_id: row.remoteOperationId,
    provider_lineage: row.intent.providerLineageId, bank_generation: row.intent.bankGeneration };
  const digest = createHash("sha256").update("taki-native-references.v1\n");
  for (const reference of publication.references) digest.update(`${nativeProofJson(nativeReferenceFields(reference))}\n`);
  const operation = row.intent.operation;
  const result = HindsightNativeResultSchema.parse({ ...identity, bank_id: row.intent.bank.bankId, operation_kind: operation.kind,
    request_hash: row.dispatch.requestHash, native_outcome: publication.outcome, native_through_cursor: publication.cursor,
    inputs: operation.kind === "retain" ? [{ input_index: 0, document_id: row.documentId, update_mode: operation.request.updateMode,
      prepared_input_hash: "a".repeat(64), document_hash: "b".repeat(64), created_count: publication.references.length,
      full_result_count: publication.references.length, first_ordinal: 0 }] : [], mutation: publication.mutation,
    manifest: { total_records: publication.references.length, page_size: 128,
      total_pages: Math.ceil(publication.references.length / 128), references_sha256: digest.digest("hex") },
    result_hash: "0".repeat(64), native_receipt_hash: "0".repeat(64) });
  result.result_hash = nativeProofHash(nativeResultFields(result)); result.native_receipt_hash = nativeProofHash(nativeReceiptFields(result));
  const pages = Array.from({ length: result.manifest.total_pages }, (_, pageNumber) => {
    const references = publication.references.slice(pageNumber * 128, (pageNumber + 1) * 128);
    return HindsightNativeResultPageSchema.parse({ ...identity, bank_id: result.bank_id, operation_kind: result.operation_kind,
      result_hash: result.result_hash, page_number: pageNumber, first_ordinal: pageNumber * 128, references,
      page_sha256: nativeProofHash(["taki-native-page.v1", result.result_hash, pageNumber, references.map(nativeReferenceFields)]) });
  });
  return { result, pages };
}
function status(result: HindsightNativeResult) {
  return HindsightNativeResultStatusSchema.parse({ contract_version: result.contract_version, operation_id: result.operation_id,
    provider_lineage: result.provider_lineage, bank_generation: result.bank_generation, bank_id: result.bank_id,
    operation_kind: result.operation_kind, request_hash: result.request_hash, status: "completed", progress: null, result });
}
