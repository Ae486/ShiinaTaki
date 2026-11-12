/**
 * INPUT: trusted primary witnesses, immutable ingestion journals and selected Memory runtime evidence
 * OUTPUT: current/unavailable/withdrawn source state without new ingestion, reads or authority selection
 * POS: core/memory — synchronous Intention lifetime adapter; the original receipt is always the baseline
 */
import type { IntentionSourceWitness } from "../initiative/intentions/intention-source.ts";
import type { Database } from "../db/sqlite.ts";
import { readPrimaryMemorySource } from "../db/primary-memory-source-read.ts";
import { readCanonicalRecord, readCanonicalSource } from "../db/canonical-memory-maintenance-records.ts";
import { readCanonicalSnapshot } from "../db/canonical-memory-maintenance-storage.ts";
import { readCanonicalMaintenanceReceipt } from "../db/canonical-memory-maintenance-journal.ts";
import { readMemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";
import { LocalIngestionReceiptSchema, type CanonicalIngestionState, type PreparedLocalIngestion } from "./canonical-ingestion-plan.ts";
import { sameApplicationValue } from "./hindsight/hindsight-application-integrity.ts";
import type { HindsightRuntimeState } from "./hindsight/hindsight-runtime-state.ts";
import type { HindsightIngestionBatch, HindsightIngestionCoverage, HindsightIngestionState } from "./hindsight/hindsight-ingestion-contract.ts";
import { readHindsightMemoryWrite } from "../db/hindsight-memory-write-storage.ts";
import { readHindsightSourceEvidence } from "./hindsight/hindsight-recall-evidence.ts";
import { recordEligible } from "./memory-recall-selection.ts";

export type PrimaryMemorySourceState = "current" | "unavailable" | "withdrawn";
export function createPrimaryMemorySourceState(input: {
  db: Database; assertAlive(): void; hindsight(): HindsightRuntimeState | undefined;
}): (witness: IntentionSourceWitness) => PrimaryMemorySourceState {
  return (witness) => {
    try {
      input.assertAlive(); const source = readPrimaryMemorySource(input.db, witness);
      if (source.kind === "withdrawn") return "withdrawn";
      const selection = readMemoryAuthoritySelection(input.db);
      if (source.kind === "unbound") return source.epochId && source.epochId !== selection.epochId ? "unavailable" : "current";
      const { state } = source;
      if (state.epochId !== selection.epochId) return "unavailable";
      const gate = state.gate;
      if (!gate || gate.decision === "skip" || witness.userTimelineSeq < gate.fromSeq
        || witness.userTimelineSeq > gate.throughSeq || !state.source.messages.some((message) =>
        message.id === witness.userTimelineId && message.seq === witness.userTimelineSeq)) return "current";
      if (source.kind === "local") return selection.mode === "canonical-local" ? localSourceState(input.db, source.state) : "unavailable";
      const hindsight = input.hindsight();
      if (!hindsight || selection.mode !== "hindsight") return "unavailable";
      hindsight.runtime.assertConnection();
      if (!hindsight.provider.capabilitiesSnapshot()) return "unavailable";
      return hindsightSourceState(hindsight, source.state);
    } catch { return "unavailable"; }
  };
}

function localSourceState(db: Database, state: CanonicalIngestionState): PrimaryMemorySourceState {
  const batches = state.extraction?.batches ?? [];
  if (!batches.length) return "current";
  for (const batch of batches) {
    const receipt = readCanonicalMaintenanceReceipt(db, batch, { kind: "ingest", decode: (value) => LocalIngestionReceiptSchema.parse(value) });
    // A saved plan is not confirmation. If a write committed before its ACK was journaled, use its actual receipt.
    if (!receipt) continue;
    const saved = state.bankReceipts.find((item) => item.bankId === batch.bankId);
    if (saved && !sameApplicationValue(saved.result, receipt)) return "unavailable";
    const source = readCanonicalSource(db, { ...batch, documentId: receipt.documentId });
    if (!source || source.revision !== receipt.sourceRevision || source.contentHash !== batch.source.contentHash
      || source.retainedText !== batch.source.retainedText || !sameApplicationValue(source.provenance, batch.source.provenance)) return "withdrawn";
    for (const ref of [...receipt.memories, ...receipt.reinforced]) {
      const result = localRecordState(db, { batch, ref });
      if (result !== "current") return result;
    }
  }
  return "current";
}

function localRecordState(db: Database, input: { batch: PreparedLocalIngestion; ref: { memoryId: string; revision: number } }): PrimaryMemorySourceState {
  const identity = { ...input.batch, ...input.ref };
  const original = readCanonicalSnapshot(db, identity); const current = readCanonicalRecord(db, identity);
  if (!original) return "unavailable";
  if (!current || !sameApplicationValue(current, original)
    || !recordEligible(current, { query: input.batch.source.retainedText ?? "", now: Date.now() })) return "withdrawn";
  return "current";
}

function hindsightSourceState(runtime: HindsightRuntimeState, state: HindsightIngestionState): PrimaryMemorySourceState {
  for (const batch of state.batches) {
    if (!runtime.runtime.resolveBanks(state.characterId).some((bank) => sameApplicationValue(bank, batch.bank))) return "unavailable";
    const checkpoint = runtime.replica.checkpoint(batch.bank.bankId);
    if (!checkpoint || checkpoint.authorityEpochId !== state.epochId) return "unavailable";
    if (checkpoint.bankDeleted) return "withdrawn";
    if (checkpoint.namespace.provider_lineage !== batch.providerLineageId
      || checkpoint.namespace.bank_generation !== batch.bankGeneration) return "unavailable";
    const scope = { bankId: batch.bank.bankId, namespace: checkpoint.namespace };
    const receipt = resolveHindsightPrimaryReceipt(runtime, { state, batch });
    if (typeof receipt === "string") return receipt;
    if (receipt.evidence.kind !== "provider") return "unavailable";
    const sourceHead = runtime.replica.nativeHead({ ...scope, objectKind: "document", objectId: receipt.evidence.result.documentId });
    if (sourceHead?.binding_state === "tombstoned" || receipt.sourceBinding && sourceHead?.version
      && !sameApplicationValue(sourceHead.version, receipt.sourceBinding.version)) return "withdrawn";
    const source = readHindsightSourceEvidence(runtime.replica, { ...scope, documentId: receipt.evidence.result.documentId });
    if (source.kind !== "current") return source.kind;
    if (!receipt.sourceBinding || !receipt.memoryBindings) return "unavailable";
    if (!sameApplicationValue(source.head, receipt.sourceBinding)) return "withdrawn";
    if (source.source.revision !== receipt.evidence.result.sourceRevision
      || source.original.original_source.retainedText !== batch.request.content
      || !sameApplicationValue(source.original.original_source.provenance, batch.request.provenance)) return "withdrawn";
    for (const ref of receipt.evidence.result.memories) {
      const original = receipt.memoryBindings.find((binding) => binding.policy.memoryId === ref.memoryId);
      if (!original) return "unavailable";
      const head = runtime.replica.nativeHead({ ...scope, objectKind: "memory_unit", objectId: ref.memoryId });
      if (head?.binding_state === "tombstoned" || head?.version && head.version.object_revision !== ref.revision) return "withdrawn";
      if (head?.binding_state !== "bound" || !head.bound_artifact) return "unavailable";
      const record = runtime.replica.record({ ...scope, memoryId: ref.memoryId, includeHidden: true, includeInvalidated: true });
      if (!record) return "unavailable";
      if (record.unit.revision !== ref.revision
        || !sameApplicationValue(record.policy, original.policy)
        || !recordEligible(record, { query: batch.request.content, now: Date.now() })) return "withdrawn";
      if (!sameApplicationValue(head, original.head)) return "withdrawn";
    }
  }
  return state.batches.length ? "current" : "unavailable";
}

export function resolveHindsightPrimaryReceipt(runtime: Pick<HindsightRuntimeState, "db" | "pending">,
  input: { state: Pick<HindsightIngestionState, "epochId" | "receipts">; batch: HindsightIngestionBatch }): HindsightIngestionCoverage | PrimaryMemorySourceState {
  const { state, batch } = input; const saved = state.receipts.find((item) => item.bankId === batch.bank.bankId);
  if (!saved) return "unavailable";
  if (saved.evidence.kind === "provider" && saved.sourceBinding && saved.memoryBindings) return saved;
  if (saved.evidence.kind === "outbox") {
    const pending = runtime.pending.get({ authorityEpochId: state.epochId, bankId: batch.bank.bankId, operationId: saved.evidence.operationId });
    if (!pending || pending.intentHash !== saved.evidence.intentHash) return "unavailable";
    if (pending.phase === "cancelled") return "withdrawn";
    if (pending.phase !== "completed") return "unavailable";
  }
  // A recovered Pending source uses the original whole-write completion evidence. Reading the latest policy here
  // would miss a correction made after recovery but before this first source-state lookup.
  const write = readHindsightMemoryWrite(runtime.db, { authorityEpochId: state.epochId, bankId: batch.bank.bankId, requestId: batch.requestId });
  if (!write || write.identity.namespace.provider_lineage !== batch.providerLineageId
    || write.identity.namespace.bank_generation !== batch.bankGeneration || write.identity.operation.kind !== "retain"
    || !sameApplicationValue(write.identity.operation.request, batch.request)
    || write.terminal?.kind !== "retain" || !write.terminal.sourceLifetime) return "unavailable";
  return { ...saved, ...write.terminal.sourceLifetime, status: "confirmed", evidence: { kind: "provider", result: write.terminal.result } };
}
