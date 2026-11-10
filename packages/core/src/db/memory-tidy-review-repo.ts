/**
 * INPUT:  exact captured Local memory/Block revisions and accepted review batches
 * OUTPUT: persisted coverage and automatic retry eligibility, independent of attempt ownership
 * POS:    core/db — tidy producer checkpoints; the operation owner remains the execution authority
 */
import { assertCanonicalLocalAuthority } from "./canonical-memory-maintenance-storage.ts";
import type { Database } from "./sqlite.ts";

export interface TidyReviewedMemory { bankId: string; memoryId: string; revision: number; reviewedAt: string; }
export interface TidyReviewedBlock { blockId: string; revision: number; reviewedAt: string; }
export interface TidyRetryState { pending: boolean; failures: number; retryAt: string | null; }
export interface TidyCoverage {
  memories: TidyReviewedMemory[];
  blocks: TidyReviewedBlock[];
  retry: TidyRetryState;
}
export interface TidyReviewCommit {
  memories: Array<Omit<TidyReviewedMemory, "reviewedAt">>;
  blocks: Array<Omit<TidyReviewedBlock, "reviewedAt">>;
  at: string;
  onCommitted?: () => void;
}
export interface MemoryTidyReviewRepo {
  read(characterId: string): TidyCoverage;
  commit(characterId: string, batch: TidyReviewCommit): void;
  begin(characterId: string): void;
  continued(characterId: string): void;
  succeeded(characterId: string): void;
  failed(characterId: string, at: string): TidyRetryState;
}

const RETRY_DELAYS = [60_000, 5 * 60_000] as const;

export function createMemoryTidyReviewRepo(db: Database, epochId: string): MemoryTidyReviewRepo {
  const scope = (characterId: string) => ({ epoch: epochId, character: characterId });
  return {
    read(characterId) {
      assertCanonicalLocalAuthority(db, epochId);
      const params = scope(characterId);
      const memories = db.prepare(`SELECT bank_id,memory_id,revision,reviewed_at FROM memory_tidy_reviews
        WHERE authority_epoch_id=:epoch AND character_id=:character`).all(params).map((row) => ({
        bankId: String(row.bank_id), memoryId: String(row.memory_id), revision: Number(row.revision), reviewedAt: String(row.reviewed_at),
      }));
      const blocks = db.prepare(`SELECT block_id,revision,reviewed_at FROM memory_tidy_block_reviews
        WHERE authority_epoch_id=:epoch AND character_id=:character`).all(params).map((row) => ({
        blockId: String(row.block_id), revision: Number(row.revision), reviewedAt: String(row.reviewed_at),
      }));
      return { memories, blocks, retry: retryState(db, params) };
    },
    commit: (characterId, batch) => commit(db, { ...scope(characterId), batch }),
    begin: (characterId) => updateRetry(db, { ...scope(characterId), state: { ...retryState(db, scope(characterId)), pending: true } }),
    continued: (characterId) => updateRetry(db, { ...scope(characterId), state: { pending: true, failures: 0, retryAt: null } }),
    succeeded: (characterId) => updateRetry(db, { ...scope(characterId), state: { pending: false, failures: 0, retryAt: null } }),
    failed(characterId, at) {
      const current = retryState(db, scope(characterId));
      const delay = RETRY_DELAYS[current.failures];
      const state = { pending: true, failures: current.failures + 1,
        retryAt: delay === undefined ? null : new Date(Date.parse(at) + delay).toISOString() };
      updateRetry(db, { ...scope(characterId), state });
      return state;
    },
  };
}

function commit(db: Database, input: { epoch: string; character: string; batch: TidyReviewCommit }): void {
  const { batch, ...scope } = input;
  db.transaction(() => {
    assertCanonicalLocalAuthority(db, scope.epoch);
    for (const memory of batch.memories) {
      db.prepare(`INSERT INTO memory_tidy_reviews VALUES (:epoch,:character,:bank,:memory,:revision,:at)
        ON CONFLICT(authority_epoch_id,character_id,bank_id,memory_id) DO UPDATE SET
        revision=excluded.revision,reviewed_at=excluded.reviewed_at WHERE excluded.revision>=memory_tidy_reviews.revision`)
        .run({ ...scope, bank: memory.bankId, memory: memory.memoryId, revision: memory.revision, at: batch.at });
    }
    for (const block of batch.blocks) {
      db.prepare(`INSERT INTO memory_tidy_block_reviews VALUES (:epoch,:character,:block,:revision,:at)
        ON CONFLICT(authority_epoch_id,character_id,block_id) DO UPDATE SET
        revision=excluded.revision,reviewed_at=excluded.reviewed_at WHERE excluded.revision>=memory_tidy_block_reviews.revision`)
        .run({ ...scope, block: block.blockId, revision: block.revision, at: batch.at });
    }
    batch.onCommitted?.();
  });
}

function retryState(db: Database, params: { epoch: string; character: string }): TidyRetryState {
  const row = db.prepare(`SELECT pending,failures,retry_at FROM memory_tidy_retry
    WHERE authority_epoch_id=:epoch AND character_id=:character`).get(params);
  return row ? { pending: row.pending === 1, failures: Number(row.failures), retryAt: row.retry_at === null ? null : String(row.retry_at) }
    : { pending: false, failures: 0, retryAt: null };
}

function updateRetry(db: Database, input: { epoch: string; character: string; state: TidyRetryState }): void {
  assertCanonicalLocalAuthority(db, input.epoch);
  db.prepare(`INSERT INTO memory_tidy_retry VALUES (:epoch,:character,:pending,:failures,:retry)
    ON CONFLICT(authority_epoch_id,character_id) DO UPDATE SET pending=excluded.pending,failures=excluded.failures,retry_at=excluded.retry_at`)
    .run({ epoch: input.epoch, character: input.character, pending: Number(input.state.pending), failures: input.state.failures, retry: input.state.retryAt });
}
