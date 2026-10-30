/**
 * INPUT:  exact primary Timeline commits and captured Local ingestion spans/decisions/receipts
 * OUTPUT: durable source witnesses, one pending span per Character, and receipt-guarded watermarks
 * POS:    core/db — canonical automatic-ingestion journal; no model work or authority switching
 */
import type { CanonicalMemoryMaintenanceRepo } from "./canonical-memory-maintenance-contract.ts";
import { assertCanonicalMaintenanceScope, canonicalMemoryAtomic } from "./canonical-memory-maintenance-storage.ts";
import { createCanonicalIngestionSourceRepo, assertCanonicalIngestionScope as assertScope,
  type CanonicalIngestionSourceRepo, type IngestionScope } from "./canonical-ingestion-source-repo.ts";
import { stableRequestHash } from "./canonical-memory-repo.ts";
import type { Database, SqlRow } from "./sqlite.ts";
import {
  CanonicalIngestionStateSchema, CanonicalWriteGateDecisionSchema, LocalExtractionPlanSchema,
  canonicalIngestionIdentity, assertIngestionBatchSource, type CanonicalIngestionState, type CanonicalWriteGateDecision,
  type LocalExtractionPlan,
} from "../memory/canonical-ingestion-plan.ts";
import {
  ingestionSourceDigest,
  type PrimaryConversationCommit, type ProvenPrimaryEntry, type SanitizedCommittedSpan,
} from "../memory/canonical-ingestion-source.ts";

export type { IngestionScope } from "./canonical-ingestion-source-repo.ts";
interface StateUpdate { state: CanonicalIngestionState; now: string }
export interface CanonicalIngestionRepo {
  recordPrimaryCommitted(input: PrimaryConversationCommit & { epochId?: string }): void;
  latestPrimarySeq(characterId: string): number;
  primaryEntries(input: { characterId: string; fromSeq: number; throughSeq: number }): ProvenPrimaryEntry[];
  cursor(scope: IngestionScope): number;
  eligibilityStartSeq(scope: IngestionScope): number | undefined;
  initializeBaseline(input: IngestionScope & { throughSeq: number; now: string }): number;
  pendingEntries(input: IngestionScope & { throughSeq: number }): ProvenPrimaryEntry[];
  unprocessedCount(scope: IngestionScope): number;
  hasApplicableSource(input: IngestionScope & { throughSeq: number }): boolean;
  advanceCoverage(input: IngestionScope & { throughSeq: number; now: string }): number;
  pending(scope: IngestionScope): CanonicalIngestionState | undefined;
  start(input: IngestionScope & { source: SanitizedCommittedSpan; now: string }): CanonicalIngestionState;
  saveGate(input: StateUpdate & { gate: CanonicalWriteGateDecision }): CanonicalIngestionState;
  saveExtraction(input: StateUpdate & { extraction: LocalExtractionPlan }): CanonicalIngestionState;
  acknowledgeBank(input: StateUpdate & { bankId: string }): CanonicalIngestionState;
  complete(input: StateUpdate): CanonicalIngestionState;
}

type RepoInput = { db: Database; maintenance: Pick<CanonicalMemoryMaintenanceRepo, "ingestReceipt"> };
type RepoContext = RepoInput & { sources: CanonicalIngestionSourceRepo };

export function createCanonicalIngestionRepo(input: RepoInput): CanonicalIngestionRepo {
  const sources = createCanonicalIngestionSourceRepo(input.db);
  const ctx = { ...input, sources };
  return {
    recordPrimaryCommitted: sources.recordPrimaryCommitted, latestPrimarySeq: sources.latestPrimarySeq,
    primaryEntries: sources.primaryEntries, cursor: sources.cursor, eligibilityStartSeq: sources.eligibilityStartSeq,
    initializeBaseline: sources.initializeBaseline, pendingEntries: sources.pendingEntries,
    unprocessedCount: sources.unprocessedCount, hasApplicableSource: sources.hasApplicableSource,
    advanceCoverage: sources.advanceCoverage,
    pending: (scope) => pending(ctx.db, scope),
    start: (input) => start(ctx, input),
    saveGate: (input) => saveGate(ctx, input),
    saveExtraction: (input) => saveExtraction(ctx, input),
    acknowledgeBank: (input) => acknowledgeBank(ctx, input),
    complete: (input) => complete(ctx, input),
  };
}

function pending(db: Database, scope: IngestionScope): CanonicalIngestionState | undefined {
  assertScope(db, scope);
  const row = db.prepare(`SELECT * FROM canonical_memory_ingestion_spans
    WHERE authority_epoch_id=:epoch AND character_id=:character AND state='pending'`)
    .get({ epoch: scope.epochId, character: scope.characterId });
  return row ? parseCanonicalIngestionState(row) : undefined;
}

function start(ctx: RepoContext, input: IngestionScope & { source: SanitizedCommittedSpan; now: string }): CanonicalIngestionState {
  const db = ctx.db;
  return canonicalMemoryAtomic(db, () => {
    const existing = pending(db, input);
    if (existing) return existing;
    ctx.sources.assertAvailable(input);
    const current = input.source;
    const sourceHash = ingestionSourceDigest(current);
    const spanId = canonicalIngestionIdentity({ epochId: input.epochId, characterId: input.characterId, sourceHash });
    db.prepare(`INSERT INTO canonical_memory_ingestion_spans
      (authority_epoch_id,character_id,span_id,from_seq,through_seq,source_hash,source_json,bank_receipts_json,state,revision,created_at,updated_at)
      VALUES (:epoch,:character,:span,:after,:through,:hash,:source,'[]','pending',1,:at,:at)`)
      .run({ epoch: input.epochId, character: input.characterId, span: spanId, after: current.fromSeq,
        through: current.throughSeq, hash: sourceHash, source: JSON.stringify(current), at: input.now });
    ctx.sources.claim({ ...input, spanId });
    return requireState(db, { ...input, spanId });
  });
}

function saveGate(ctx: RepoContext, input: StateUpdate & { gate: CanonicalWriteGateDecision }): CanonicalIngestionState {
  return canonicalMemoryAtomic(ctx.db, () => {
    const state = current(ctx.db, input.state);
    const gate = CanonicalWriteGateDecisionSchema.parse(input.gate);
    if (state.gate !== null) {
      if (stableRequestHash(state.gate) !== stableRequestHash(gate)) throw new Error("MEMORY_REQUEST_ID_CONFLICT");
      return state;
    }
    if (gate.decision === "keep" && (gate.fromSeq > gate.throughSeq
      || !state.source.messages.some((message) => message.seq === gate.fromSeq)
      || !state.source.messages.some((message) => message.seq === gate.throughSeq))) throw new Error("MEMORY_INVALID_REQUEST");
    return update(ctx.db, { ...state, gate, updatedAt: input.now });
  });
}

function saveExtraction(ctx: RepoContext, input: StateUpdate & { extraction: LocalExtractionPlan }): CanonicalIngestionState {
  return canonicalMemoryAtomic(ctx.db, () => {
    const state = current(ctx.db, input.state);
    if (state.gate?.decision !== "keep") throw new Error("MEMORY_INVALID_REQUEST");
    const extraction = LocalExtractionPlanSchema.parse(input.extraction);
    if (state.extraction && stableRequestHash(state.extraction.facts) !== stableRequestHash(extraction.facts)) {
      throw new Error("MEMORY_REQUEST_ID_CONFLICT");
    }
    const banks = new Set<string>();
    for (const batch of extraction.batches) {
      if (batch.epochId !== state.epochId || batch.characterId !== state.characterId || banks.has(batch.bankId)) {
        throw new Error("MEMORY_INVALID_REQUEST");
      }
      assertIngestionBatchSource(state, batch);
      assertCanonicalMaintenanceScope(ctx.db, batch);
      const bank = ctx.db.prepare(`SELECT scope_kind FROM canonical_memory_banks
        WHERE authority_epoch_id=:epoch AND bank_id=:bank`).get({ epoch: batch.epochId, bank: batch.bankId });
      if (state.gate.route !== "both" && bank?.scope_kind !== state.gate.route) throw new Error("MEMORY_INVALID_REQUEST");
      banks.add(batch.bankId);
    }
    for (const prior of state.extraction?.batches ?? []) {
      const next = extraction.batches.find((batch) => batch.bankId === prior.bankId);
      if (!next || stableRequestHash(next) !== stableRequestHash(prior) && ctx.maintenance.ingestReceipt(prior)) {
        throw new Error("MEMORY_REQUEST_ID_CONFLICT");
      }
    }
    return update(ctx.db, { ...state, extraction, updatedAt: input.now });
  });
}

function acknowledgeBank(ctx: RepoContext, input: StateUpdate & { bankId: string }): CanonicalIngestionState {
  return canonicalMemoryAtomic(ctx.db, () => {
    const state = current(ctx.db, input.state);
    const batch = state.extraction?.batches.find((item) => item.bankId === input.bankId);
    if (!batch) throw new Error("MEMORY_INVALID_REQUEST");
    const result = ctx.maintenance.ingestReceipt(batch);
    if (!result) throw new Error("MEMORY_INGESTION_RECEIPT_UNPROVEN");
    const receipt = { bankId: batch.bankId, requestId: batch.requestId, result };
    const prior = state.bankReceipts.find((item) => item.bankId === input.bankId);
    if (prior) {
      if (stableRequestHash(prior) !== stableRequestHash(receipt)) throw new Error("MEMORY_INGESTION_RECEIPT_UNPROVEN");
      return state;
    }
    return update(ctx.db, { ...state, bankReceipts: [...state.bankReceipts, receipt], updatedAt: input.now });
  });
}

function complete(ctx: RepoContext, input: StateUpdate): CanonicalIngestionState {
  return canonicalMemoryAtomic(ctx.db, () => {
    const state = current(ctx.db, input.state);
    if (state.gate === null) throw new Error("MEMORY_INGESTION_INCOMPLETE");
    if (state.gate.decision === "keep") verifyCompletion(ctx, state);
    ctx.sources.assertClaimed(state);
    const changed = ctx.db.prepare(`UPDATE canonical_memory_ingestion_cursors SET through_seq=MAX(through_seq,:through),updated_at=:at
      WHERE authority_epoch_id=:epoch AND character_id=:character`)
      .run({ epoch: state.epochId, character: state.characterId,
        through: state.source.throughSeq, at: input.now });
    if (changed.changes !== 1) throw new Error("MEMORY_INGESTION_STALE_CURSOR");
    ctx.db.prepare(`INSERT INTO memory_auto_state(character_id,last_episodic_seq,last_flush_seq)
      VALUES (:character,:through,:through) ON CONFLICT(character_id) DO UPDATE SET
      last_episodic_seq=MAX(memory_auto_state.last_episodic_seq,excluded.last_episodic_seq),
      last_flush_seq=MAX(memory_auto_state.last_flush_seq,excluded.last_flush_seq)`)
      .run({ character: state.characterId, through: state.source.throughSeq });
    return update(ctx.db, { ...state, state: "complete", updatedAt: input.now });
  });
}

function verifyCompletion(ctx: RepoContext, state: CanonicalIngestionState): void {
  if (state.gate?.decision !== "keep" || state.extraction === null) throw new Error("MEMORY_INGESTION_INCOMPLETE");
  const expected = ctx.db.prepare(`SELECT bank_id,scope_kind,character_id FROM canonical_memory_banks
    WHERE authority_epoch_id=:epoch AND (scope_kind='global' OR character_id=:character)`)
    .all({ epoch: state.epochId, character: state.characterId }).filter((bank) => state.gate?.decision === "keep"
      && (state.gate.route === "both" || state.gate.route === bank.scope_kind));
  const count = state.gate.route === "both" ? 2 : 1;
  if (expected.length !== count || new Set(expected.map((bank) => bank.scope_kind)).size !== count
    || state.extraction.batches.length !== count || state.bankReceipts.length !== count) {
    throw new Error("MEMORY_INGESTION_INCOMPLETE");
  }
  for (const bank of expected) {
    const batch = state.extraction.batches.find((item) => item.bankId === bank.bank_id);
    const receipt = state.bankReceipts.find((item) => item.bankId === bank.bank_id);
    const actual = batch ? ctx.maintenance.ingestReceipt(batch) : undefined;
    if (!actual || !receipt || stableRequestHash(actual) !== stableRequestHash(receipt.result)) {
      throw new Error("MEMORY_INGESTION_RECEIPT_UNPROVEN");
    }
  }
}

function current(db: Database, expected: CanonicalIngestionState): CanonicalIngestionState {
  const state = requireState(db, expected);
  if (state.state !== "pending" || state.revision !== expected.revision) throw new Error("MEMORY_INGESTION_STALE_REVISION");
  return state;
}

function requireState(db: Database, input: IngestionScope & { spanId: string }): CanonicalIngestionState {
  assertScope(db, input);
  const row = db.prepare(`SELECT * FROM canonical_memory_ingestion_spans
    WHERE authority_epoch_id=:epoch AND character_id=:character AND span_id=:span`)
    .get({ epoch: input.epochId, character: input.characterId, span: input.spanId });
  if (!row) throw new Error("MEMORY_INGESTION_NOT_FOUND");
  return parseCanonicalIngestionState(row);
}

function update(db: Database, state: CanonicalIngestionState): CanonicalIngestionState {
  const changed = db.prepare(`UPDATE canonical_memory_ingestion_spans
    SET gate_json=:gate,extraction_json=:extraction,bank_receipts_json=:receipts,state=:state,
    revision=revision+1,updated_at=:at WHERE authority_epoch_id=:epoch AND character_id=:character
    AND span_id=:span AND revision=:revision AND state='pending'`)
    .run({ epoch: state.epochId, character: state.characterId, span: state.spanId, revision: state.revision,
      gate: state.gate === null ? null : JSON.stringify(state.gate),
      extraction: state.extraction === null ? null : JSON.stringify(state.extraction),
      receipts: JSON.stringify(state.bankReceipts), state: state.state, at: state.updatedAt });
  if (changed.changes !== 1) throw new Error("MEMORY_INGESTION_STALE_REVISION");
  return requireState(db, state);
}

export function parseCanonicalIngestionState(row: SqlRow): CanonicalIngestionState {
  try {
    const state = CanonicalIngestionStateSchema.parse({ epochId: row.authority_epoch_id, characterId: row.character_id,
      spanId: row.span_id, sourceHash: row.source_hash, source: JSON.parse(String(row.source_json)),
      gate: row.gate_json === null ? null : JSON.parse(String(row.gate_json)),
      extraction: row.extraction_json === null ? null : JSON.parse(String(row.extraction_json)),
      bankReceipts: JSON.parse(String(row.bank_receipts_json)), state: row.state, revision: row.revision,
      createdAt: row.created_at, updatedAt: row.updated_at });
    if (state.characterId !== state.source.characterId || state.source.fromSeq !== row.from_seq
      || state.source.throughSeq !== row.through_seq || ingestionSourceDigest(state.source) !== state.sourceHash
      || canonicalIngestionIdentity(state) !== state.spanId) throw new Error();
    for (const batch of state.extraction?.batches ?? []) assertIngestionBatchSource(state, batch);
    return state;
  } catch { throw new Error("MEMORY_INGESTION_STATE_INVALID"); }
}
