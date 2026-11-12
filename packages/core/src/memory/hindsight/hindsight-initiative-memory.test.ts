import { afterEach, describe, expect, it, vi } from "vitest";
import type { TakiApplicationSourceBody } from "@taki/shared";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { APPLICATION_TEST_AT as at, applicationTestArtifact, applicationTestBody, applicationTestNative,
  applicationTestSourcePayload, applicationTestEvent, applicationTestMemoryPayload, applicationTestMemoryBody } from "../../testing/hindsight-application-fixtures.ts";
import { applicationTestBind, applicationTestBoundMemory } from "../../testing/hindsight-application-runtime-fixtures.ts";
import { curatorTestBank, curatorTestRemotePolicy, type CuratorTestBank } from "./hindsight-policy-curator-fixtures.ts";
import { createInitiativeMemoryRecall } from "../initiative-memory-recall.ts";
import { captureHindsightIngestionBinding, createHindsightRecallEvidence, readHindsightSourceEvidence } from "./hindsight-recall-evidence.ts";
import { createHindsightIngestionRepo } from "../../db/hindsight-ingestion-repo.ts";
import { sanitizeCommittedPrimarySpan } from "../canonical-ingestion-source.ts";
import { createPrimaryMemorySourceState } from "../primary-memory-source-state.ts";
import { patternDigest } from "../../initiative/patterns/pattern-source.ts";
import type { HindsightIngestionBatch } from "./hindsight-ingestion-contract.ts";

const cleanup: HindsightRuntimeFixture[] = [];
afterEach(async () => { for (const f of cleanup.splice(0)) await f.close(); vi.restoreAllMocks(); });
const options = { toolCallId: "selected-topic", messages: [], context: {} };

function sourceBank(characterId?: string) {
  const bank = curatorTestBank({ bankId: characterId ? "bank-taki" : "bank-a", characterId, memories: [] });
  const document = applicationTestNative({ kind: "document", scope: bank.scope, cursor: 2,
    payload: applicationTestSourcePayload(bank.scope), source: { text: "The interview outcome remains unknown", context: null, metadata: {} } });
  const version = document.head.version!;
  const value: TakiApplicationSourceBody = { original_source: { authorityEpochId: "epoch", bankId: bank.scope.bankId,
    documentId: "document-a", contentHash: null, retainedText: "The interview outcome remains unknown", context: null,
    tags: [], metadata: {}, observationScopes: "shared", revision: 1, createdAt: at, updatedAt: at,
    provenance: { actor: "user", origin: "explicit-user", characterId: characterId ?? null,
      timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true, sourceRef: null } },
    encoded_metadata: {}, original_witness: { source_kind: "document", source_id: version.object_id,
      source_revision: version.object_revision, source_payload_hash: version.payload_hash }, operation_id: null };
  const artifact = applicationTestArtifact({ scope: bank.scope, key: { artifact_kind: "source", artifact_id: "source-a" },
    binding: { kind: "exact_native", native: version }, body: applicationTestBody("application-source.v1", value, bank.scope) });
  applicationTestBind(document, artifact.artifact);
  const memory = applicationTestBoundMemory({ scope: bank.scope, bankScope: bank.bankScope,
    payload: { document_id: "document-a", text: "The interview outcome remains unknown" } });
  bank.native.push(document, memory.native); bank.artifacts.push(artifact, memory.application);
  return bank;
}
function fixture() {
  const banks = [sourceBank(), sourceBank("taki")];
  const f = hindsightRuntimeFixture({ banks }); cleanup.push(f); return f;
}
function publishNative(bank: CuratorTestBank, native: ReturnType<typeof applicationTestNative>) {
  const from = { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state };
  bank.native = bank.native.map((entry) => entry.head.object_kind === native.head.object_kind && entry.head.object_id === native.head.object_id ? native : entry);
  const event = applicationTestEvent({ scope: bank.scope, from, native: [native] });
  bank.events.push(event); bank.server.cursor.native = event.manifest.to_checkpoint.native_cursor;
  bank.server.cursor.state = event.manifest.to_checkpoint.state_cursor;
}

function publishRetainedSource(bank: CuratorTestBank, batch: HindsightIngestionBatch) {
  const document = applicationTestNative({ kind: "document", scope: bank.scope, cursor: 3,
    payload: { ...applicationTestSourcePayload(bank.scope), document_id: batch.request.documentId! },
    source: { text: batch.request.content, context: batch.request.context, metadata: batch.request.metadata } });
  const version = document.head.version!;
  const source: TakiApplicationSourceBody = { original_source: { authorityEpochId: "epoch", bankId: bank.scope.bankId,
    documentId: batch.request.documentId!, contentHash: null, retainedText: batch.request.content, context: batch.request.context,
    tags: [], metadata: batch.request.metadata, observationScopes: null, revision: 1, createdAt: at, updatedAt: at,
    provenance: batch.request.provenance }, encoded_metadata: {}, original_witness: { source_kind: "document", source_id: version.object_id,
    source_revision: version.object_revision, source_payload_hash: version.payload_hash }, operation_id: null };
  const artifact = applicationTestArtifact({ scope: bank.scope, key: { artifact_kind: "source", artifact_id: "ingested-source" },
    binding: { kind: "exact_native", native: version }, body: applicationTestBody("application-source.v1", source, bank.scope) });
  applicationTestBind(document, artifact.artifact);
  const memoryNative = applicationTestNative({ kind: "memory_unit", scope: bank.scope, cursor: 4,
    payload: applicationTestMemoryPayload({ bank_id: bank.scope.bankId, memory_id: "ingested-memory",
      document_id: batch.request.documentId!, text: "Tomorrow's interview outcome remains unknown" }) });
  if (!memoryNative.head.version) throw new Error("fixture memory version missing");
  const memoryBody = applicationTestMemoryBody(memoryNative.head.version);
  memoryBody.policy = { ...memoryBody.policy, bankId: bank.scope.bankId };
  memoryBody.provenance = { ...memoryBody.provenance, characterId: bank.bankScope.characterId };
  const memoryApplication = applicationTestArtifact({ scope: bank.scope,
    key: { artifact_kind: "memory", artifact_id: memoryNative.head.object_id },
    binding: { kind: "exact_native", native: memoryNative.head.version },
    body: applicationTestBody("application-memory.v1", memoryBody, bank.scope) });
  applicationTestBind(memoryNative, memoryApplication.artifact);
  const memory = { native: memoryNative, application: memoryApplication };
  const from = { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state };
  const event = applicationTestEvent({ scope: bank.scope, from, native: [document, memory.native], artifacts: [artifact, memory.application] });
  bank.native.push(document, memory.native); bank.artifacts.push(artifact, memory.application); bank.events.push(event);
  bank.server.cursor.native = event.manifest.to_checkpoint.native_cursor; bank.server.cursor.state = event.manifest.to_checkpoint.state_cursor;
}

async function primarySourceFixture() {
  const f = fixture(); const subsystem = f.subsystem(); await subsystem.captureRun("taki");
  const { state: runtime } = subsystem; const scope = { epochId: "epoch", characterId: "taki" };
  const user = f.timeline.append({ characterId: "taki", role: "user", content: "My interview is tomorrow" });
  const assistant = f.timeline.append({ characterId: "taki", role: "assistant", content: "We can talk afterward" });
  const row = f.db.prepare("SELECT id,seq,character_id,role,content,parts,created_at FROM timeline_messages WHERE id=:id").get({ id: user.id })!;
  const witness = { characterId: "taki", userTimelineId: user.id, userTimelineSeq: user.seq, sourceDigest: patternDigest(row) };
  const sourceState = createPrimaryMemorySourceState({ db: f.db, assertAlive: () => undefined, hindsight: () => runtime });
  expect(sourceState(witness)).toBe("current");
  subsystem.recordPrimaryCommitted({ characterId: "taki", entries: [user, assistant] });
  const journal = createHindsightIngestionRepo({ db: f.db, pending: runtime.pending,
    readVerifiedBank: (bankId) => runtime.replica.bankBinding(bankId)?.bank, captureBinding: captureHindsightIngestionBinding(runtime.replica) });
  const source = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: assistant.seq,
    entries: journal.pendingEntries({ ...scope, throughSeq: assistant.seq }) });
  let state = journal.start({ ...scope, source, now: at });
  state = journal.saveGate({ state, gate: { decision: "keep", route: "character", fromSeq: user.seq, throughSeq: assistant.seq }, now: at });
  state = journal.prepareBanks({ state, banks: runtime.runtime.resolveBanks("taki"), now: at });
  const batch = state.batches[0]!; const bank = f.banks[1]!;
  publishRetainedSource(bank, batch); await subsystem.captureRun("taki");
  state = journal.acknowledgeBank({ state, bankId: bank.scope.bankId, now: at, result: {
    ok: true, requestId: batch.requestId, providerId: "hindsight", authorityEpochId: "epoch", capabilities: runtime.provider.capabilitiesSnapshot(),
    data: { status: "completed", documentId: batch.request.documentId, sourceRevision: 1, memories: [{ memoryId: "ingested-memory", revision: 1 }] },
  } });
  journal.complete({ state, now: at });
  expect(state.receipts[0]?.sourceBinding).toBeDefined(); expect(state.receipts[0]?.memoryBindings).toHaveLength(1);
  return { f, subsystem, runtime, witness, sourceState, state, bank };
}

describe("Hindsight selected initiative evidence under actual runtime composition", () => {
  it("retains the immutable primary receipt policy baseline before any later source-state lookup", async () => {
    const f = await primarySourceFixture();
    curatorTestRemotePolicy(f.bank, "ingested-memory", (body) => ({ ...body, policy: { ...body.policy, importance: 6, policyVersion: 2 } }));
    await f.subsystem.captureRun("taki");
    expect(f.sourceState(f.witness)).toBe("withdrawn");
    expect(f.f.db.prepare("SELECT content FROM timeline_messages WHERE id=:id").get({ id: f.witness.userTimelineId })?.content).toBe("My interview is tomorrow");
  });

  it("keeps confirmed primary evidence under its Hindsight authority during a verified outage", async () => {
    const f = await primarySourceFixture();
    expect(f.sourceState(f.witness)).toBe("current"); f.f.remote.control.offline = true;
    expect(f.sourceState(f.witness)).toBe("current");
    f.f.config.upsert("TAKI_HINDSIGHT_ENDPOINT", "http://127.0.0.1:18482");
    expect(f.sourceState(f.witness)).toBe("unavailable");
  });

  it("refuses historical receipts without original policy evidence instead of capturing the latest policy", async () => {
    const f = await primarySourceFixture();
    const receipts = f.state.receipts.map((value) => { const receipt = { ...value }; delete receipt.sourceBinding; delete receipt.memoryBindings; return receipt; });
    f.f.db.prepare("UPDATE hindsight_ingestion_spans SET receipts_json=:receipts WHERE span_id=:span")
      .run({ receipts: JSON.stringify(receipts), span: f.state.spanId });
    expect(f.sourceState(f.witness)).toBe("unavailable");
  });

  it("keeps a temporarily unbound unchanged unit unavailable without terminal source withdrawal", async () => {
    const f = await primarySourceFixture(); const replica = f.f.replica; const scope = f.bank.scope;
    const original = f.bank.native.find((entry) => entry.head.object_id === "ingested-memory")!;
    const missing = { ...original, head: { ...original.head, binding_state: "binding_missing" as const, bound_artifact: null } };
    const checkpoint = replica.checkpoint(scope.bankId)!;
    const event = applicationTestEvent({ scope, from: checkpoint.checkpoint, native: [missing] });
    const lease = replica.leases.acquire({ bankId: scope.bankId, ownerId: "source-lifetime-test", durationMs: 60_000 });
    try {
      replica.applyEvent({ ...scope, authorityEpochId: "epoch", expectedBank: { bankId: scope.bankId, scope: "character", characterId: "taki" },
        expectedCheckpoint: checkpoint, expectedNativeCheckpoint: checkpoint.native, lease,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(), event });
    } finally { replica.leases.release(lease); }
    expect(f.sourceState(f.witness)).toBe("unavailable");
  });
  it.each([false, true])("reads verified direct records with offline=%s and preserves degraded truth", async (offline) => {
    const f = fixture(); const runtime = f.compose(); let captured = await runtime.captureRun("taki");
    f.remote.control.offline = offline;
    if (offline) captured = await runtime.captureRun("taki");
    const recalled = createInitiativeMemoryRecall(captured, { query: "interview", scopes: ["global", "character"] });
    for (const scope of ["global", "character"] as const) {
      expect(await recalled.tools.recall!.execute!({ scope }, options)).toMatchObject({
        status: offline ? "partial" : "confirmed", vectorState: offline ? "degraded" : "ready",
        records: [{ text: "The interview outcome remains unknown", confirmed: true }],
      });
    }
    expect(recalled.isCurrent()).toBe(true); expect(runtime.selected.legacy).toBeNull();
    expect(f.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(0);
  });

  it("withdraws held text after an app-only policy edit even when native revision remains unchanged", async () => {
    const f = fixture(); const runtime = f.compose(); const captured = await runtime.captureRun("taki");
    const recalled = createInitiativeMemoryRecall(captured, { query: "interview", scopes: ["global"] });
    await recalled.tools.recall!.execute!({ scope: "global" }, options);
    curatorTestRemotePolicy(f.banks[0]!, "memory-a", (body) => ({ ...body, policy: { ...body.policy, importance: 6, policyVersion: 2 } }));
    await runtime.captureRun("taki");
    expect(f.replica.record({ ...f.banks[0]!.scope, memoryId: "memory-a" })?.unit.revision).toBe(1);
    expect(recalled.isCurrent()).toBe(false);
  });

  it.each(["edit", "invalidate", "delete"] as const)("closes held direct-unit evidence after verified %s", async (change) => {
    const f = fixture(); const runtime = f.compose(); const captured = await runtime.captureRun("taki");
    const recalled = createInitiativeMemoryRecall(captured, { query: "interview", scopes: ["global"] });
    await recalled.tools.recall!.execute!({ scope: "global" }, options);
    const bank = f.banks[0]!;
    const changed = applicationTestNative({ kind: "memory_unit", scope: bank.scope, cursor: 3,
      payload: applicationTestMemoryPayload({ bank_id: bank.scope.bankId, revision: 2,
        text: change === "edit" ? "The interview was cancelled" : "The interview outcome remains unknown",
        state: change === "invalidate" ? "invalidated" : "valid", invalidated_at: change === "invalidate" ? at : null,
        invalidation_reason: change === "invalidate" ? "withdrawn" : null }) });
    const original = bank.native.find((entry) => entry.head.object_kind === "memory_unit")!.head;
    changed.head = { ...changed.head, binding_state: "rebind_required", bound_artifact: original.bound_artifact, previous_version: original.version };
    if (change === "delete") changed.head = { ...changed.head, binding_state: "tombstoned", version: null,
      body_ref: null, bound_artifact: null, tombstone: { object_kind: "memory_unit", object_id: "memory-a", object_revision: 2,
        native_cursor: 3, last_payload_hash: original.version!.payload_hash } };
    publishNative(bank, changed);
    await runtime.captureRun("taki");
    expect(recalled.isCurrent()).toBe(false);
  });

  it("rejects a corrected document's old original witness before the first evidence lookup", async () => {
    const f = fixture(); const runtime = f.compose(); await runtime.captureRun("taki"); const bank = f.banks[0]!;
    const changed = applicationTestNative({ kind: "document", scope: bank.scope, revision: 2, cursor: 3,
      payload: applicationTestSourcePayload(bank.scope), source: { text: "The interview was cancelled", context: null, metadata: {} } });
    const source = bank.artifacts.find((entry) => entry.artifact.key.artifact_kind === "source")!;
    const replacement = applicationTestArtifact({ scope: bank.scope, key: source.artifact.key, revision: source.artifact.revision + 1,
      binding: { kind: "exact_native", native: changed.head.version! }, body: source.body });
    applicationTestBind(changed, replacement.artifact);
    const from = { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state };
    bank.native = bank.native.map((entry) => entry.head.object_kind === "document" ? changed : entry);
    bank.artifacts = bank.artifacts.map((entry) => entry === source ? replacement : entry);
    const event = applicationTestEvent({ scope: bank.scope, from, native: [changed], artifacts: [replacement] });
    bank.events.push(event); bank.server.cursor.native = event.manifest.to_checkpoint.native_cursor;
    bank.server.cursor.state = event.manifest.to_checkpoint.state_cursor;
    await runtime.captureRun("taki");
    expect(readHindsightSourceEvidence(f.replica, { ...bank.scope, documentId: "document-a" }).kind).toBe("withdrawn");
    const record = f.replica.record({ ...bank.scope, memoryId: "memory-a" })!;
    const capture = createHindsightRecallEvidence({ replica: f.replica, assertCurrent: () => undefined });
    expect(capture(record, "interview")).toBeUndefined();
  });

  it("refuses a changed route across recall await and never promotes Local during a cold outage", async () => {
    const f = fixture(); const runtime = f.compose(); const captured = await runtime.captureRun("taki");
    f.remote.control.beforeRecall = async () => { f.config.upsert("TAKI_HINDSIGHT_ENDPOINT", "http://127.0.0.1:18482"); };
    const recalled = createInitiativeMemoryRecall(captured, { query: "interview", scopes: ["global"] });
    expect(await recalled.tools.recall!.execute!({ scope: "global" }, options)).toMatchObject({ status: "unavailable", records: [] });
    expect(recalled.isCurrent()).toBe(false); expect(runtime.selected.legacy).toBeNull();
    const coldGlobal = sourceBank(); const coldBanks = [coldGlobal, sourceBank("taki")];
    const cold = hindsightRuntimeFixture({ banks: coldBanks }); cleanup.push(cold);
    const witnesses = structuredClone(coldBanks.map((bank) => ({ native: bank.native, artifacts: bank.artifacts })));
    const authority = cold.db.prepare("SELECT * FROM memory_authority_selection WHERE singleton=1").get();
    cold.remote.control.offline = true;
    const coldRuntime = cold.compose(); const unavailable = await coldRuntime.captureRun("taki");
    expect(unavailable.snapshot).toMatchObject({ providerId: "hindsight", authorityEpochId: "epoch",
      providerLineageId: coldGlobal.scope.namespace.provider_lineage,
      capabilities: { providerId: "hindsight", retain: false, recall: false, reflect: false, edit: false,
        invalidate: false, restore: false, conditionalMutation: false, idempotentWrites: false,
        sparseRetrieval: false, vectorRetrieval: "unavailable", derivedMemoryRead: false } });
    expect(unavailable.tools).toEqual({}); expect(unavailable.automaticRecall).toBeUndefined();
    const unavailableRecall = createInitiativeMemoryRecall(unavailable, { query: "interview", scopes: ["global", "character"] });
    // Binding freshness remains true; unavailable capabilities still forbid every memory read.
    expect(unavailableRecall.tools).toEqual({}); expect(unavailableRecall.isCurrent()).toBe(true);
    expect(coldRuntime.selected.legacy).toBeNull();
    expect(cold.db.prepare("SELECT * FROM memory_authority_selection WHERE singleton=1").get()).toEqual(authority);
    expect(coldBanks.map((bank) => ({ native: bank.native, artifacts: bank.artifacts }))).toEqual(witnesses);
  });
});
