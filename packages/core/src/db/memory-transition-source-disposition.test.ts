import { describe, expect, it } from "vitest";
import { MemoryTransitionPendingSourceSchema, PendingMemoryIntentSchema, RetainRequestSchema } from "@taki/shared";
import { hindsightRuntimeFixture } from "../testing/hindsight-runtime-composition-fixtures.ts";
import { ensureHindsightPendingSource } from "../memory/hindsight/hindsight-application-source-write.ts";
import { classifyTransitionSources } from "./memory-transition-source-disposition.ts";
import { pendingMemoryRef } from "./pending-memory-store.ts";
import { createHindsightMemoryWriteRepo } from "./hindsight-memory-write-repo.ts";
import { prepareTrackedDispatch } from "../memory/hindsight/hindsight-native-proof.ts";
import { resolveTrackedPending } from "../memory/hindsight/hindsight-pending-native-result.ts";
import { createHindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { readTransitionTargetReceipt } from "./memory-transition-effect-repo.ts";
import { randomUUID } from "node:crypto";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";

async function fixture() {
  const f = hindsightRuntimeFixture(); const runtime = f.subsystem(); await runtime.captureRun("taki");
  const { state } = runtime; const bank = state.runtime.banks()[0]!; const at = new Date().toISOString();
  const checkpoint = state.replica.checkpoint(bank.bankId)!;
  const request = RetainRequestSchema.parse({ bankId: bank.bankId, content: "An original awaiting Source", context: null,
    timestamp: null, tags: [], entities: [], metadata: {}, observationScopes: null, documentId: null, strategy: null, updateMode: "replace",
    provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: null, timelineToSeq: null,
      capturedAt: at, sanitized: true, sourceRef: null }, policy: { layerId: "profile", importance: 5, visibility: "retrieved",
      disclosure: null, origin: "self", emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1 } });
  const row = state.pending.enqueue(PendingMemoryIntentSchema.parse({ schemaVersion: 1, authorityEpochId: "epoch", providerId: "hindsight",
    providerLineageId: state.runtime.epoch.providerLineageId, bankGeneration: checkpoint.namespace.bank_generation, bank,
    operationId: "original-native-child", originalAt: at, baseCursor: checkpoint.checkpoint.native_cursor,
    operation: { kind: "retain", zeroResultAllowed: true, request } }));
  await ensureHindsightPendingSource({ writer: state.writer, record: row, context: { timeoutMs: 1000 } });
  const original = f.banks.find((value) => value.scope.bankId === bank.bankId)!.artifacts
    .find((entry) => entry.artifact.binding.kind === "awaiting_native")!;
  if (original.body.content.body_schema !== "application-source.v1") throw new Error("source fixture missing");
  const source = MemoryTransitionPendingSourceSchema.parse({ localBankId: "logical-bank", nativeBankId: bank.bankId,
    namespace: checkpoint.namespace, evidenceId: "a".repeat(64), proofHash: "b".repeat(64),
    artifact: { key: original.artifact.key, revision: original.artifact.revision, record_hash: original.artifact.record_hash },
    bodyRef: original.body.ref, base64: Buffer.from(original.body.bytes).toString("base64"), operationId: row.remoteOperationId,
    documentId: row.documentId, source: original.body.content.value, tombstoned: false });
  const lease = state.nativeReplica.leases.acquire({ bankId: bank.bankId, ownerId: "disposition", durationMs: 60_000 });
  const guard = { lease, deadlineAt: lease.expiresAt };
  return { ...f, state, row, source, guard, candidate: { pendingSources: [source] } };
}

describe("actual Pending and application Source disposition joins", () => {
  it.each(["source", "target"] as const)("rejects %s no-effect evidence whose Pending payload names another operation", async (side) => {
    const f = await fixture();
    try {
      const parent = createHindsightMemoryWriteRepo({ db: f.db, assertActive: f.state.assertActive });
      const requestId = randomUUID();
      const job = parent.prepare({ identity: { key: { authorityEpochId: "epoch", bankId: f.row.intent.bank.bankId, requestId },
        namespace: f.source.namespace, actor: "foreground-agent", operation: f.row.intent.operation },
        nativeOperationId: f.row.intent.operationId, target: null });
      f.state.pending.cancelQueued(pendingMemoryRef(f.row));
      parent.finish({ key: job.identity.key, revision: job.revision, terminal: { kind: "error", code: "MEMORY_OPERATION_CANCELLED" } });
      if (f.row.intent.operation.kind !== "retain") throw new Error("retain fixture missing");
      const input = { provider: "hindsight" as const, command: { kind: "retain" as const, request: f.row.intent.operation.request }, execution: {
        intentId: randomUUID(), replayId: randomUUID(), targetRequestId: requestId, targetEpochId: "epoch",
        targetBankId: f.row.intent.bank.bankId, targetLogicalId: f.row.documentId!, expectedRevision: null,
        mappingHash: "a".repeat(64), preparedAt: f.row.intent.originalAt } };
      const read = () => side === "source" ? classifyTransitionSources(f.db, f.candidate) : readTransitionTargetReceipt(f.db, input);
      expect(read).not.toThrow();
      const stored = f.db.prepare("SELECT state_json FROM pending_memory WHERE operation_id=:id").get({ id: f.row.intent.operationId })!;
      const state = JSON.parse(String(stored.state_json)); state.intent.operationId = "foreign-operation";
      state.intentHash = canonicalPayloadHash(state.intent);
      f.db.prepare("UPDATE pending_memory SET state_json=:json WHERE operation_id=:id").run({ id: f.row.intent.operationId, json: JSON.stringify(state) });
      expect(read).toThrow();
    } finally { await f.close(); }
  });

  it("keeps an unfinished parent owned, then proves claimed-but-undispatched cancellation by the original child ID", async () => {
    const f = await fixture();
    try {
      const parent = createHindsightMemoryWriteRepo({ db: f.db, assertActive: f.state.assertActive });
      const identity = { key: { authorityEpochId: "epoch", bankId: f.row.intent.bank.bankId, requestId: "original-parent" },
        namespace: f.source.namespace, actor: "foreground-agent" as const, operation: f.row.intent.operation };
      const job = parent.prepare({ identity, nativeOperationId: f.row.intent.operationId, target: null });
      const claimed = f.state.pending.claim({ record: f.row, guard: f.guard })!;
      expect(claimed.attempts).toBe(1);
      f.state.pending.cancelQueued(pendingMemoryRef(claimed));
      expect(() => classifyTransitionSources(f.db, f.candidate)).toThrow("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
      parent.finish({ key: job.identity.key, revision: job.revision, terminal: { kind: "error", code: "MEMORY_OPERATION_CANCELLED" } });
      expect(classifyTransitionSources(f.db, f.candidate)[0]).toMatchObject({ disposition: "not-dispatched", operationId: f.row.remoteOperationId });
      expect(() => classifyTransitionSources(f.db, { pendingSources: [{ ...f.source, documentId: "foreign" }] })).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    } finally { await f.close(); }
  });

  it.each([0, 1])("treats a factual G1 cancellation with %s committed parts honestly", async (committed) => {
    const f = await fixture();
    try {
      const claimed = f.state.pending.claim({ record: f.row, guard: f.guard })!;
      const row = f.state.pending.progress({ record: claimed, guard: f.guard,
        change: { kind: "dispatch", preparedMutation: null, dispatch: prepareTrackedDispatch(claimed, null) } });
      const client = createHindsightClient({ endpoint: "http://127.0.0.1:9", resolveApiKey: () => "fixture-only",
        transport: async () => ({ status: 200, body: JSON.stringify({ contract_version: "1.0.0", operation_id: row.remoteOperationId,
          provider_lineage: row.intent.providerLineageId, bank_generation: row.intent.bankGeneration, bank_id: row.intent.bank.bankId,
          operation_kind: "retain", request_hash: row.dispatch!.protocol === "tracked_native_v1" ? row.dispatch!.requestHash : null,
          status: "cancelled", reason: "task_cancelled", result: null,
          progress: { expected_inputs: 1, completed_inputs: 0, committed_parts: committed } }) }) });
      await resolveTrackedPending({ client, pending: f.state.pending, replica: f.state.nativeReplica, guard: f.guard,
        nativeResultSupported: true, now: () => new Date().toISOString(), request: () => ({ timeoutMs: 1000 }),
        onFailure: (_record, error) => { throw error; } }, row);
      const parent = createHindsightMemoryWriteRepo({ db: f.db, assertActive: f.state.assertActive });
      const requestId = randomUUID();
      const job = parent.prepare({ identity: { key: { authorityEpochId: "epoch", bankId: row.intent.bank.bankId, requestId },
        namespace: f.source.namespace, actor: "foreground-agent", operation: row.intent.operation }, nativeOperationId: row.intent.operationId, target: null });
      parent.finish({ key: job.identity.key, revision: job.revision, terminal: { kind: "error", code: "MEMORY_OPERATION_CANCELLED" } });
      if (row.intent.operation.kind !== "retain") throw new Error("retain fixture missing");
      const receipt = readTransitionTargetReceipt(f.db, { provider: "hindsight", command: { kind: "retain", request: row.intent.operation.request },
        execution: { intentId: randomUUID(), replayId: randomUUID(), targetRequestId: requestId, targetEpochId: "epoch",
          targetBankId: row.intent.bank.bankId, targetLogicalId: row.documentId!, expectedRevision: null,
          mappingHash: "a".repeat(64), preparedAt: row.intent.originalAt } });
      if (committed === 0) expect(receipt?.outcome).toMatchObject({ status: "failed", errorCode: "MEMORY_OPERATION_CANCELLED" });
      else expect(receipt).toBeUndefined();
      if (committed === 0) expect(classifyTransitionSources(f.db, f.candidate)[0]?.disposition).toBe("refused");
      else expect(() => classifyTransitionSources(f.db, f.candidate)).toThrow("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
    } finally { await f.close(); }
  });
});
