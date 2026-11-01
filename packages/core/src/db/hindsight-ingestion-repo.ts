/**
 * INPUT:  exact primary witnesses, one source-only gate/Bank plan and real authority/outbox receipts
 * OUTPUT: restart-safe Hindsight source ingestion journal and receipt-verified retirement coverage
 * POS:    core/db — synchronous ingestion transactions; never runs models, replays Pending or mutates replicas
 */
import { MemoryReplicaBankSchema, type MemoryReplicaBank } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import { createHindsightIngestionSourceRepo } from "./hindsight-ingestion-source-repo.ts";
import { assertHindsightIngestionScope as assertScope, hindsightIngestionAtomic as atomic,
  readHindsightIngestionBinding, assertHindsightIngestionBinding } from "./hindsight-ingestion-guard.ts";
import { pendingHindsightSourceCoverage, captureHindsightSourceCoverage, assertHindsightSourceCoverage,
  type HindsightIngestionDurabilityDeps } from "./hindsight-ingestion-durability.ts";
import { CanonicalWriteGateDecisionSchema, type CanonicalWriteGateDecision } from "../memory/canonical-ingestion-plan.ts";
import { ingestionSourceDigest, type SanitizedCommittedSpan } from "../memory/canonical-ingestion-source.ts";
import { HindsightIngestionStateSchema, hindsightIngestionIdentity, prepareHindsightIngestionBatch,
  assertHindsightIngestionPlan, type HindsightIngestionScope, type HindsightIngestionState } from "../memory/hindsight/hindsight-ingestion-contract.ts";
import { canonicalJson } from "../memory/legacy-migration/legacy-identities.ts";

interface Update { state: HindsightIngestionState; now: string }
type RepoContext = HindsightIngestionDurabilityDeps & { sources: ReturnType<typeof createHindsightIngestionSourceRepo> };

export function createHindsightIngestionRepo(deps: HindsightIngestionDurabilityDeps) {
  const sources = createHindsightIngestionSourceRepo(deps.db); const ctx = { ...deps, sources };
  return {
    ...sources,
    pending: (scope: HindsightIngestionScope) => pending(ctx.db, scope),
    start: (input: HindsightIngestionScope & { source: SanitizedCommittedSpan; now: string }) => start(ctx, input),
    saveGate: (input: Update & { gate: CanonicalWriteGateDecision }) => saveGate(ctx, input),
    prepareBanks: (input: Update & { banks: readonly MemoryReplicaBank[] }) => prepareBanks(ctx, input),
    pendingCoverage: (input: { state: HindsightIngestionState; bankId: string }) => {
      const state = requireState(ctx.db, input.state); const batch = requireBatch(state, input.bankId);
      return pendingHindsightSourceCoverage(ctx, { ...state, batch });
    },
    acknowledgeBank: (input: Update & { bankId: string; result?: unknown }) => acknowledgeBank(ctx, input),
    complete: (input: Update) => complete(ctx, input),
    advanceCoverage: (input: HindsightIngestionScope & { throughSeq: number; now: string }) => advanceCoverage(ctx, input),
  };
}
export type HindsightIngestionRepo = ReturnType<typeof createHindsightIngestionRepo>;

function pending(db: Database, scope: HindsightIngestionScope): HindsightIngestionState | undefined {
  assertScope(db, scope);
  const row = db.prepare(`SELECT * FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch
    AND character_id=:character AND state='pending'`).get({ epoch: scope.epochId, character: scope.characterId });
  return row ? parseHindsightIngestionState(row) : undefined;
}

function start(ctx: RepoContext, input: HindsightIngestionScope & { source: SanitizedCommittedSpan; now: string }): HindsightIngestionState {
  return atomic(ctx.db, input, () => {
    const existing = pending(ctx.db, input); if (existing) return existing;
    ctx.sources.assertAvailable(input);
    const sourceHash = ingestionSourceDigest(input.source);
    const spanId = hindsightIngestionIdentity({ ...input, sourceHash });
    const epoch = assertScope(ctx.db, input);
    ctx.db.prepare(`INSERT INTO hindsight_ingestion_spans
      (authority_epoch_id,provider_lineage_id,character_id,span_id,from_seq,through_seq,source_hash,source_json,
       gate_json,batches_json,receipts_json,state,revision,created_at,updated_at)
      VALUES (:epoch,:lineage,:character,:span,:after,:through,:hash,:source,NULL,'[]','[]','pending',1,:at,:at)`)
      .run({ epoch: input.epochId, lineage: epoch.providerLineageId, character: input.characterId, span: spanId,
        after: input.source.fromSeq, through: input.source.throughSeq, hash: sourceHash, source: JSON.stringify(input.source), at: input.now });
    ctx.sources.claim({ ...input, spanId });
    return requireState(ctx.db, { ...input, spanId });
  });
}

function saveGate(ctx: RepoContext, input: Update & { gate: CanonicalWriteGateDecision }): HindsightIngestionState {
  return atomic(ctx.db, input.state, () => {
    const state = current(ctx.db, input.state); const gate = CanonicalWriteGateDecisionSchema.parse(input.gate);
    ctx.sources.assertClaimed(state);
    if (state.gate !== null) {
      if (canonicalJson(state.gate) !== canonicalJson(gate)) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
      return state;
    }
    if (gate.decision === "keep" && (gate.fromSeq > gate.throughSeq
      || !state.source.messages.some((message) => message.seq === gate.fromSeq)
      || !state.source.messages.some((message) => message.seq === gate.throughSeq))) throw new Error("MEMORY_INVALID_REQUEST");
    return update(ctx.db, { ...state, gate, updatedAt: input.now });
  });
}

function prepareBanks(ctx: RepoContext, input: Update & { banks: readonly MemoryReplicaBank[] }): HindsightIngestionState {
  return atomic(ctx.db, input.state, () => {
    const state = current(ctx.db, input.state); const gate = state.gate;
    ctx.sources.assertClaimed(state);
    if (gate?.decision !== "keep") throw new Error("MEMORY_INGESTION_INCOMPLETE");
    if (state.batches.length > 0) return state;
    const selected = input.banks.map((bank) => MemoryReplicaBankSchema.parse(bank))
      .filter((bank) => gate.route === "both" || bank.scope === gate.route)
      .sort((left, right) => left.scope === right.scope ? 0 : left.scope === "global" ? -1 : 1);
    const batches = selected.map((bank) => prepareHindsightIngestionBatch(state,
      readHindsightIngestionBinding(ctx, { ...state, bank })));
    if (batches.length !== (gate.route === "both" ? 2 : 1)) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    // The whole selected Bank plan commits before the first asynchronous retain. The gate is already durable.
    return update(ctx.db, { ...state, batches, updatedAt: input.now });
  });
}

function acknowledgeBank(ctx: RepoContext, input: Update & { bankId: string; result?: unknown }): HindsightIngestionState {
  return atomic(ctx.db, input.state, () => {
    const state = current(ctx.db, input.state); const batch = requireBatch(state, input.bankId);
    ctx.sources.assertClaimed(state);
    const previous = state.receipts.find((receipt) => receipt.bankId === input.bankId);
    if (previous) { assertHindsightSourceCoverage(ctx, { ...state, batch, receipt: previous }); return state; }
    const receipt = captureHindsightSourceCoverage(ctx, { ...state, batch, result: input.result });
    return update(ctx.db, { ...state, receipts: [...state.receipts, receipt], updatedAt: input.now });
  });
}

function complete(ctx: RepoContext, input: Update): HindsightIngestionState {
  return atomic(ctx.db, input.state, () => {
    const state = current(ctx.db, input.state);
    ctx.sources.assertClaimed(state); assertReceipts(ctx, state);
    if (state.gate === null || state.receipts.length !== state.batches.length
      || state.gate.decision === "keep" && state.batches.length !== (state.gate.route === "both" ? 2 : 1)) throw new Error("MEMORY_INGESTION_INCOMPLETE");
    const completed = update(ctx.db, { ...state, state: "complete", updatedAt: input.now });
    ctx.sources.advanceCoverage({ ...state, throughSeq: state.source.throughSeq, now: input.now });
    return completed;
  });
}

function advanceCoverage(ctx: RepoContext, input: HindsightIngestionScope & { throughSeq: number; now: string }): number {
  return atomic(ctx.db, input, () => {
    const rows = ctx.db.prepare(`SELECT * FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch
      AND character_id=:character AND from_seq<:through AND state='complete'`)
      .all({ epoch: input.epochId, character: input.characterId, through: input.throughSeq });
    for (const row of rows) {
      const state = parseHindsightIngestionState(row);
      ctx.sources.assertClaimed(state); assertReceipts(ctx, state);
    }
    return ctx.sources.advanceCoverage(input);
  });
}

function assertReceipts(ctx: RepoContext, state: HindsightIngestionState): void {
  if (assertScope(ctx.db, state).providerLineageId !== state.providerLineageId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  for (const batch of state.batches) {
    assertHindsightIngestionBinding(ctx, { ...state, ...batch });
    const receipt = state.receipts.find((value) => value.bankId === batch.bank.bankId);
    if (!receipt) throw new Error("MEMORY_INGESTION_INCOMPLETE");
    assertHindsightSourceCoverage(ctx, { ...state, batch, receipt });
  }
}

function requireBatch(state: HindsightIngestionState, bankId: string) {
  const batch = state.batches.find((value) => value.bank.bankId === bankId);
  if (!batch || state.gate?.decision !== "keep") throw new Error("MEMORY_INGESTION_INCOMPLETE");
  return batch;
}
function requireState(db: Database, input: HindsightIngestionScope & { spanId: string }): HindsightIngestionState {
  const epoch = assertScope(db, input);
  const row = db.prepare(`SELECT * FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch
    AND character_id=:character AND span_id=:span`).get({ epoch: input.epochId, character: input.characterId, span: input.spanId });
  if (!row) throw new Error("MEMORY_INGESTION_NOT_FOUND");
  const state = parseHindsightIngestionState(row);
  if (state.providerLineageId !== epoch.providerLineageId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  return state;
}
function current(db: Database, expected: HindsightIngestionState): HindsightIngestionState {
  const actual = requireState(db, expected);
  if (actual.state !== "pending" || actual.revision !== expected.revision) throw new Error("MEMORY_INGESTION_STALE_REVISION");
  return actual;
}
function update(db: Database, raw: HindsightIngestionState): HindsightIngestionState {
  const state = HindsightIngestionStateSchema.parse(raw); assertHindsightIngestionPlan(state);
  const changed = db.prepare(`UPDATE hindsight_ingestion_spans SET gate_json=:gate,batches_json=:batches,receipts_json=:receipts,
    state=:state,revision=revision+1,updated_at=:at WHERE authority_epoch_id=:epoch AND character_id=:character
    AND span_id=:span AND revision=:revision AND state='pending'`)
    .run({ epoch: state.epochId, character: state.characterId, span: state.spanId, revision: state.revision,
      gate: state.gate === null ? null : JSON.stringify(state.gate), batches: JSON.stringify(state.batches),
      receipts: JSON.stringify(state.receipts), state: state.state, at: state.updatedAt });
  if (changed.changes !== 1) throw new Error("MEMORY_INGESTION_STALE_REVISION");
  return requireState(db, state);
}
export function parseHindsightIngestionState(row: SqlRow): HindsightIngestionState {
  try {
    const state = HindsightIngestionStateSchema.parse({ epochId: row.authority_epoch_id, providerLineageId: row.provider_lineage_id,
      characterId: row.character_id, spanId: row.span_id, sourceHash: row.source_hash, source: JSON.parse(String(row.source_json)),
      gate: row.gate_json === null ? null : JSON.parse(String(row.gate_json)), batches: JSON.parse(String(row.batches_json)),
      receipts: JSON.parse(String(row.receipts_json)), state: row.state, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at });
    if (state.characterId !== state.source.characterId || state.source.fromSeq !== row.from_seq || state.source.throughSeq !== row.through_seq
      || ingestionSourceDigest(state.source) !== state.sourceHash || hindsightIngestionIdentity(state) !== state.spanId) throw new Error();
    assertHindsightIngestionPlan(state);
    return state;
  } catch { throw new Error("MEMORY_INGESTION_STATE_INVALID"); }
}
