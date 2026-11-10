/**
 * INPUT:  captured compaction snapshots, fenced lifecycle transitions, cancellation, and summary replacement CAS
 * OUTPUT: fenced summary commits, immutable lifecycle events and optional cache baselines/post-commit notifications
 * POS:    core/db — sole durable coordination/evidence writer for conversation compaction; never a Run/Timeline authority
 */
import { CharacterIdSchema } from "@taki/shared";
import { z } from "zod";
import type { Database, SqlRow } from "./sqlite.ts";
import { captureCacheUsageBaseline } from "./cache-usage-repo.ts";

const OperationStateSchema = z.enum(["open", "committed", "failed", "cancelled", "abandoned"]);
const FailureCodeSchema = z.enum([
  "LEGACY_FLUSH_FAILED", "MEMORY_AUTHORITY_FENCED", "MEMORY_FLUSH_INCOMPLETE", "MEMORY_FLUSH_FAILED",
  "HINDSIGHT_RUNTIME_UNAVAILABLE", "SUMMARY_GENERATION_FAILED", "SUMMARY_EMPTY", "SOURCE_STALE",
  "SUMMARY_CONFLICT", "COMPACTION_INTERNAL_ERROR", "LEASE_EXPIRED",
]);
const EventKindSchema = z.enum([
  "started", "flush_completed", "summary_generated", "committed", "failed", "cancelled", "abandoned",
]);
const BoundedId = z.string().min(1).max(100);
const Digest = z.string().regex(/^[0-9a-f]{64}$/);
const Timestamp = z.string().min(1).max(40);

export type CompactionFailureCode = z.infer<typeof FailureCodeSchema>;
export type CompactionOperationState = z.infer<typeof OperationStateSchema>;

export interface CompactionLease {
  operationId: string;
  characterId: string;
  owner: string;
  fence: number;
  attemptNo: number;
  expiresAt: string;
}

export interface CompactionOperation {
  operationId: string; characterId: string; runId: string | null; attemptId: string | null;
  state: CompactionOperationState; attemptNo: number; selectedFromSeq: number; selectedThroughSeq: number;
  capturedTailSeq: number; expectedSummaryRevision: number; expectedSummaryThrough: number; sourceDigest: string;
  beforeTokens: number; provider: string; modelId: string; leaseFence: number; leaseExpiresAt: string | null;
  failureCode: CompactionFailureCode | null; committedSummaryRevision: number | null; updatedAt: string; terminalAt: string | null;
}

export interface CompactionEvent {
  operationId: string; operationSeq: number; characterId: string; attemptNo: number;
  kind: z.infer<typeof EventKindSchema>; occurredAt: string; failureCode: CompactionFailureCode | null;
  summaryRevision: number | null; flushStatus: "success" | "not_required" | null;
  writes: number | null; outputChars: number | null;
}

export interface BeginCompactionInput {
  operationId: string; characterId: string; runId?: string; attemptId?: string; reason: "pressure";
  selectedFromSeq: number; selectedThroughSeq: number; capturedTailSeq: number;
  expectedSummaryRevision: number; expectedSummaryThrough: number; sourceDigest: string;
  beforeTokens: number; provider: string; modelId: string; owner: string; now: string; expiresAt: string;
}

export type BeginCompactionResult =
  | { status: "started"; lease: CompactionLease }
  | { status: "active"; operation: CompactionOperation }
  | { status: "committed"; operation: CompactionOperation };

export interface CompactionOperationRepo {
  begin(input: BeginCompactionInput): BeginCompactionResult;
  /** Renew a still-current dispatch lease without claiming that memory extraction happened. */
  renewLease(input: { lease: CompactionLease; now: string; expiresAt: string }): CompactionLease | null;
  recordFlush(input: { lease: CompactionLease; status: "success" | "not_required"; writes: number; now: string; expiresAt: string }): CompactionLease | null;
  recordSummaryGenerated(input: { lease: CompactionLease; outputChars: number; now: string }): boolean;
  fail(input: { lease: CompactionLease; code: CompactionFailureCode; now: string }): boolean;
  cancelActive(input: { characterId: string; now: string }): { operationId: string } | null;
  commitSummary(input: { lease: CompactionLease; text: string; sourceDigest: string; now: string }): "committed" | "duplicate" | "conflict" | "stale";
  reconcileExpired(now: string): number;
  get(operationId: string): CompactionOperation | null;
  active(characterId: string): CompactionOperation | null;
  latestFailure(characterId: string): CompactionOperation | null;
  events(operationId: string): CompactionEvent[];
}

const BeginSchema = z.object({
  operationId: BoundedId, characterId: CharacterIdSchema, runId: BoundedId.optional(), attemptId: BoundedId.optional(),
  reason: z.literal("pressure"), selectedFromSeq: z.int().positive(), selectedThroughSeq: z.int().positive(),
  capturedTailSeq: z.int().positive(), expectedSummaryRevision: z.int().nonnegative(), expectedSummaryThrough: z.int().nonnegative(),
  sourceDigest: Digest, beforeTokens: z.int().nonnegative(), provider: z.string().min(1).max(100),
  modelId: z.string().min(1).max(200), owner: BoundedId, now: Timestamp, expiresAt: Timestamp,
}).refine((value) => value.selectedThroughSeq >= value.selectedFromSeq && value.capturedTailSeq >= value.selectedThroughSeq)
  .refine((value) => value.selectedFromSeq === value.expectedSummaryThrough + 1
    && (value.expectedSummaryRevision === 0) === (value.expectedSummaryThrough === 0))
  .refine((value) => value.attemptId === undefined || value.runId !== undefined);

const OperationRowSchema = z.object({
  operation_id: BoundedId, character_id: CharacterIdSchema, run_id: BoundedId.nullable(), attempt_id: BoundedId.nullable(),
  state: OperationStateSchema, attempt_no: z.int().positive(), selected_from_seq: z.int().positive(),
  selected_through_seq: z.int().positive(), captured_tail_seq: z.int().positive(), expected_summary_revision: z.int().nonnegative(),
  expected_summary_through: z.int().nonnegative(), source_digest: Digest, before_tokens: z.int().nonnegative(),
  provider: z.string().min(1).max(100), model_id: z.string().min(1).max(200), lease_fence: z.int().positive(),
  lease_expires_at: Timestamp.nullable(), failure_code: FailureCodeSchema.nullable(), committed_summary_revision: z.int().positive().nullable(),
  updated_at: Timestamp, terminal_at: Timestamp.nullable(),
});

const EventRowSchema = z.object({
  operation_id: BoundedId, operation_seq: z.int().positive(), character_id: CharacterIdSchema, attempt_no: z.int().positive(),
  kind: EventKindSchema, occurred_at: Timestamp, failure_code: FailureCodeSchema.nullable(), summary_revision: z.int().positive().nullable(),
  flush_status: z.enum(["success", "not_required"]).nullable(), writes: z.int().nonnegative().nullable(), output_chars: z.int().nonnegative().nullable(),
});

export function createCompactionOperationRepo(db: Database, options: { onSummaryCommitted?: () => void; onChanged?: () => void } = {}): CompactionOperationRepo {
  const observe = <T>(write: () => T): T => {
    const result = write();
    if (options.onChanged) db.afterCommit(() => {
      try { options.onChanged?.(); } catch { /* Monitor hints never alter compaction settlement. */ }
    });
    return result;
  };
  return {
    begin: (input) => observe(() => begin(db, BeginSchema.parse(input))),
    renewLease: (input) => observe(() => renewLease(db, input)),
    recordFlush: (input) => observe(() => recordFlush(db, input)),
    recordSummaryGenerated: (input) => observe(() => recordGenerated(db, input)),
    fail: (input) => observe(() => fail(db, input)),
    cancelActive: (input) => observe(() => cancelActive(db, input)),
    commitSummary: (input) => observe(() => commitSummary(db, input, options.onSummaryCommitted)),
    reconcileExpired: (now) => observe(() => reconcileExpired(db, Timestamp.parse(now))),
    get: (operationId) => readOperation(db, operationId),
    active: (characterId) => readActive(db, CharacterIdSchema.parse(characterId)),
    latestFailure: (characterId) => readLatestFailure(db, CharacterIdSchema.parse(characterId)),
    events: (operationId) => db.prepare("SELECT * FROM conversation_compaction_events WHERE operation_id=:id ORDER BY operation_seq")
      .all({ id: BoundedId.parse(operationId) }).map(toEvent),
  };
}

function begin(db: Database, input: z.infer<typeof BeginSchema>): BeginCompactionResult {
  let result: BeginCompactionResult | undefined;
  db.transaction(() => {
    abandonExpired(db, input.now, input.characterId);
    const active = readActive(db, input.characterId);
    if (active) {
      if (active.operationId === input.operationId && !sameSource(active, input)) throw new Error("COMPACTION_OPERATION_ID_CONFLICT"); result = { status: "active", operation: active }; return;
    }
    const existing = readOperation(db, input.operationId);
    if (existing?.state === "committed") {
      if (!sameSource(existing, input)) throw new Error("COMPACTION_OPERATION_ID_CONFLICT"); result = { status: "committed", operation: existing }; return;
    }
    const attemptNo = existing === null ? 1 : existing.attemptNo + 1;
    const fence = existing === null ? 1 : existing.leaseFence + 1;
    if (existing === null) insertOperation(db, { input, attemptNo, fence });
    else reopenOperation(db, { input, existing, attemptNo, fence });
    appendEvent(db, { operationId: input.operationId, kind: "started", now: input.now });
    result = { status: "started", lease: leaseOf(input, attemptNo, fence) };
  });
  if (!result) throw new Error("COMPACTION_OPERATION_NOT_STARTED");
  return result;
}

function insertOperation(db: Database, context: {
  input: z.infer<typeof BeginSchema>; attemptNo: number; fence: number;
}): void {
  const { input, attemptNo, fence } = context;
  db.prepare(`INSERT INTO conversation_compaction_operations
    (operation_id,character_id,run_id,attempt_id,reason,state,attempt_no,selected_from_seq,selected_through_seq,captured_tail_seq,
     expected_summary_revision,expected_summary_through,source_digest,before_tokens,provider,model_id,lease_owner,lease_fence,
     lease_expires_at,started_at,updated_at)
    VALUES (:operationId,:characterId,:runId,:attemptId,:reason,'open',:attemptNo,:selectedFromSeq,:selectedThroughSeq,:capturedTailSeq,
     :expectedSummaryRevision,:expectedSummaryThrough,:sourceDigest,:beforeTokens,:provider,:modelId,:owner,:fence,:expiresAt,:now,:now)`)
    .run({ ...input, runId: input.runId ?? null, attemptId: input.attemptId ?? null, attemptNo, fence });
}

function reopenOperation(db: Database, context: {
  input: z.infer<typeof BeginSchema>; existing: CompactionOperation; attemptNo: number; fence: number;
}): void {
  const { input, existing, attemptNo, fence } = context;
  if (!sameSource(existing, input)) throw new Error("COMPACTION_OPERATION_ID_CONFLICT");
  const changed = db.prepare(`UPDATE conversation_compaction_operations SET run_id=:runId,attempt_id=:attemptId,state='open',
    attempt_no=:attemptNo,captured_tail_seq=:capturedTailSeq,before_tokens=:beforeTokens,provider=:provider,model_id=:modelId,
    lease_owner=:owner,lease_fence=:fence,
    lease_expires_at=:expiresAt,failure_code=NULL,committed_summary_revision=NULL,started_at=:now,updated_at=:now,terminal_at=NULL
    WHERE operation_id=:operationId AND state IN ('failed','cancelled','abandoned')`).run({
      operationId: input.operationId, runId: input.runId ?? null, attemptId: input.attemptId ?? null, attemptNo,
      capturedTailSeq: input.capturedTailSeq, beforeTokens: input.beforeTokens, provider: input.provider,
      modelId: input.modelId, owner: input.owner,
      fence, expiresAt: input.expiresAt, now: input.now,
    });
  if (changed.changes !== 1) throw new Error("COMPACTION_OPERATION_CONFLICT");
}

function recordFlush(db: Database, input: { lease: CompactionLease; status: "success" | "not_required"; writes: number; now: string; expiresAt: string }): CompactionLease | null {
  let renewed: CompactionLease | null = null;
  db.transaction(() => {
    if (!leaseIsCurrent(db, input.lease, input.now)) return;
    appendEvent(db, { operationId: input.lease.operationId, kind: "flush_completed", now: input.now,
      detail: { flushStatus: input.status, writes: input.writes } });
    renewed = renewLease(db, input);
  });
  return renewed;
}

function renewLease(db: Database, input: { lease: CompactionLease; now: string; expiresAt: string }): CompactionLease | null {
  const now = Timestamp.parse(input.now);
  const expiresAt = Timestamp.parse(input.expiresAt);
  const changed = db.prepare(`UPDATE conversation_compaction_operations SET lease_expires_at=:expires,updated_at=:now
    WHERE operation_id=:id AND character_id=:characterId AND state='open' AND lease_owner=:owner
    AND lease_fence=:fence AND lease_expires_at>:now`)
    .run({ id: input.lease.operationId, characterId: input.lease.characterId, owner: input.lease.owner,
      fence: input.lease.fence, now, expires: expiresAt });
  return changed.changes === 1 ? { ...input.lease, expiresAt } : null;
}

function recordGenerated(db: Database, input: { lease: CompactionLease; outputChars: number; now: string }): boolean {
  let recorded = false; db.transaction(() => {
    if (!leaseIsCurrent(db, input.lease, input.now)) return;
    appendEvent(db, { operationId: input.lease.operationId, kind: "summary_generated", now: input.now, detail: { outputChars: z.int().nonnegative().parse(input.outputChars) } });
    recorded = true;
  }); return recorded;
}

function fail(db: Database, input: { lease: CompactionLease; code: CompactionFailureCode; now: string }): boolean { return terminalize(db, { lease: input.lease, state: "failed", code: FailureCodeSchema.parse(input.code), now: input.now }); }

function cancelActive(db: Database, input: { characterId: string; now: string }): { operationId: string } | null {
  const characterId = CharacterIdSchema.parse(input.characterId); const now = Timestamp.parse(input.now);
  let operationId: string | null = null;
  db.transaction(() => {
    const current = readActive(db, characterId); if (!current) return;
    const changed = db.prepare(`UPDATE conversation_compaction_operations SET state='cancelled',lease_owner=NULL,
      lease_expires_at=NULL,updated_at=:now,terminal_at=:now WHERE operation_id=:id AND state='open'`)
      .run({ id: current.operationId, now });
    if (changed.changes !== 1) return;
    appendEvent(db, { operationId: current.operationId, kind: "cancelled", now }); operationId = current.operationId;
  });
  return operationId === null ? null : { operationId };
}

function commitSummary(db: Database, input: { lease: CompactionLease; text: string; sourceDigest: string; now: string }, onCommitted?: () => void): "committed" | "duplicate" | "conflict" | "stale" {
  let result: "committed" | "duplicate" | "conflict" | "stale" = "stale";
  db.transaction(() => {
    const operation = readOperation(db, input.lease.operationId);
    if (operation?.state === "committed") { result = "duplicate"; return; }
    if (!operation || !leaseIsCurrent(db, input.lease, input.now) || operation.sourceDigest !== Digest.parse(input.sourceDigest)) return;
    const summary = db.prepare("SELECT revision,through_seq FROM conversation_summary WHERE character_id=:characterId")
      .get({ characterId: operation.characterId });
    if (Number(summary?.revision ?? 0) !== operation.expectedSummaryRevision
      || Number(summary?.through_seq ?? 0) !== operation.expectedSummaryThrough) {
      terminalizeInTransaction(db, { lease: input.lease, state: "failed", code: "SUMMARY_CONFLICT", now: input.now });
      result = "conflict"; return;
    }
    const revision = operation.expectedSummaryRevision + 1;
    const params = { characterId: operation.characterId, throughSeq: operation.selectedThroughSeq, text: input.text,
      revision, operationId: operation.operationId, fromSeq: operation.selectedFromSeq, digest: operation.sourceDigest,
      tailSeq: operation.capturedTailSeq, now: input.now };
    const changed = operation.expectedSummaryRevision === 0
      ? db.prepare(`INSERT INTO conversation_summary
          (character_id,through_seq,text,updated_at,revision,last_operation_id,source_from_seq,source_through_seq,source_digest,captured_tail_seq)
          VALUES (:characterId,:throughSeq,:text,:now,:revision,:operationId,:fromSeq,:throughSeq,:digest,:tailSeq)`).run(params)
      : db.prepare(`UPDATE conversation_summary SET through_seq=:throughSeq,text=:text,updated_at=:now,revision=:revision,
          last_operation_id=:operationId,source_from_seq=:fromSeq,source_through_seq=:throughSeq,source_digest=:digest,
          captured_tail_seq=:tailSeq WHERE character_id=:characterId AND revision=:expectedRevision`)
          .run({ ...params, expectedRevision: operation.expectedSummaryRevision });
    if (changed.changes !== 1) throw new Error("SUMMARY_CAS_FAILED");
    const terminal = db.prepare(`UPDATE conversation_compaction_operations SET state='committed',lease_owner=NULL,
      lease_expires_at=NULL,committed_summary_revision=:revision,updated_at=:now,terminal_at=:now
      WHERE operation_id=:id AND state='open' AND lease_owner=:owner AND lease_fence=:fence`).run({
        id: operation.operationId, owner: input.lease.owner, fence: input.lease.fence, revision, now: input.now });
    if (terminal.changes !== 1) throw new Error("COMPACTION_LEASE_LOST");
    appendEvent(db, { operationId: operation.operationId, kind: "committed", now: input.now,
      detail: { summaryRevision: revision } }); result = "committed";
    try { captureCacheUsageBaseline(db, operation.characterId); }
    catch { /* Missing exact metadata makes the metric unavailable; a valid summary must remain durable. */ }
    if (onCommitted) db.afterCommit(onCommitted);
  });
  return result;
}

function reconcileExpired(db: Database, now: string): number { let changed = 0; db.transaction(() => { changed = abandonExpired(db, now); }); return changed; }

function abandonExpired(db: Database, now: string, characterId?: string): number {
  const rows = db.prepare(`SELECT operation_id FROM conversation_compaction_operations WHERE state='open'
    AND lease_expires_at<=:now AND (:characterId IS NULL OR character_id=:characterId) ORDER BY updated_at LIMIT 1000`)
    .all({ now, characterId: characterId ?? null });
  let count = 0;
  for (const row of rows) {
    const operation = readOperation(db, String(row.operation_id)); if (!operation) continue;
    const updated = db.prepare(`UPDATE conversation_compaction_operations SET state='abandoned',lease_owner=NULL,
      lease_expires_at=NULL,failure_code='LEASE_EXPIRED',updated_at=:now,terminal_at=:now
      WHERE operation_id=:id AND state='open' AND lease_expires_at<=:now`).run({ id: operation.operationId, now });
    if (updated.changes === 1) { appendEvent(db, { operationId: operation.operationId, kind: "abandoned", now,
      detail: { failureCode: "LEASE_EXPIRED" } }); count += 1; }
  }
  return count;
}

function terminalize(db: Database, input: {
  lease: CompactionLease; state: "failed"; code: CompactionFailureCode; now: string;
}): boolean {
  let changed = false; db.transaction(() => { changed = terminalizeInTransaction(db, input); }); return changed;
}

function terminalizeInTransaction(db: Database, input: {
  lease: CompactionLease; state: "failed"; code: CompactionFailureCode; now: string;
}): boolean {
  const { lease, state, code, now } = input;
  const result = db.prepare(`UPDATE conversation_compaction_operations SET state=:state,lease_owner=NULL,lease_expires_at=NULL,
    failure_code=:code,updated_at=:now,terminal_at=:now WHERE operation_id=:id AND state='open' AND lease_owner=:owner
    AND lease_fence=:fence AND lease_expires_at>:now`).run({ state, code, now, id: lease.operationId, owner: lease.owner, fence: lease.fence });
  if (result.changes === 1) appendEvent(db, { operationId: lease.operationId, kind: "failed", now,
    detail: { failureCode: code } });
  return result.changes === 1;
}

function appendEvent(db: Database, input: {
  operationId: string; kind: z.infer<typeof EventKindSchema>; now: string;
  detail?: { summaryRevision?: number; flushStatus?: "success" | "not_required"; writes?: number;
    outputChars?: number; failureCode?: CompactionFailureCode };
}): void {
  const { operationId, kind, now } = input; const detail = input.detail ?? {};
  const operation = readOperation(db, operationId); if (!operation) throw new Error("COMPACTION_OPERATION_NOT_FOUND");
  const seq = Number(db.prepare("SELECT COALESCE(MAX(operation_seq),0)+1 AS seq FROM conversation_compaction_events WHERE operation_id=:id").get({ id: operationId })?.seq ?? 1);
  db.prepare(`INSERT INTO conversation_compaction_events
    (operation_id,operation_seq,character_id,attempt_no,kind,occurred_at,selected_through,before_tokens,summary_revision,
     flush_status,writes,output_chars,failure_code,lease_fence,provider,model_id,run_id,attempt_id)
    VALUES (:operationId,:seq,:characterId,:attemptNo,:kind,:now,:through,:before,:summaryRevision,:flushStatus,:writes,
     :outputChars,:failureCode,:fence,:provider,:modelId,:runId,:attemptId)`).run({ operationId, seq,
      characterId: operation.characterId, attemptNo: operation.attemptNo, kind, now, through: operation.selectedThroughSeq,
      before: operation.beforeTokens, summaryRevision: detail.summaryRevision ?? null, flushStatus: detail.flushStatus ?? null,
      writes: detail.writes ?? null, outputChars: detail.outputChars ?? null, failureCode: detail.failureCode ?? null,
      fence: operation.leaseFence, provider: operation.provider, modelId: operation.modelId,
      runId: operation.runId, attemptId: operation.attemptId });
}

function leaseIsCurrent(db: Database, lease: CompactionLease, now: string): boolean {
  return db.prepare(`SELECT 1 AS valid FROM conversation_compaction_operations WHERE operation_id=:id AND character_id=:characterId
    AND state='open' AND lease_owner=:owner AND lease_fence=:fence AND lease_expires_at>:now`).get({ id: lease.operationId,
      characterId: lease.characterId, owner: lease.owner, fence: lease.fence, now }) !== undefined;
}

function readOperation(db: Database, operationId: string): CompactionOperation | null {
  const row = db.prepare("SELECT * FROM conversation_compaction_operations WHERE operation_id=:id").get({ id: operationId });
  return row ? toOperation(row) : null;
}

function readActive(db: Database, characterId: string): CompactionOperation | null {
  const row = db.prepare("SELECT * FROM conversation_compaction_operations WHERE character_id=:characterId AND state='open'").get({ characterId });
  return row ? toOperation(row) : null;
}

function readLatestFailure(db: Database, characterId: string): CompactionOperation | null {
  const row = db.prepare("SELECT * FROM conversation_compaction_operations WHERE character_id=:characterId AND state IN ('failed','abandoned') ORDER BY updated_at DESC LIMIT 1").get({ characterId });
  return row ? toOperation(row) : null;
}
function toOperation(row: SqlRow): CompactionOperation { const value = OperationRowSchema.parse(row); return {
  operationId: value.operation_id, characterId: value.character_id, runId: value.run_id, attemptId: value.attempt_id,
  state: value.state, attemptNo: value.attempt_no, selectedFromSeq: value.selected_from_seq,
  selectedThroughSeq: value.selected_through_seq, capturedTailSeq: value.captured_tail_seq,
  expectedSummaryRevision: value.expected_summary_revision, expectedSummaryThrough: value.expected_summary_through,
  sourceDigest: value.source_digest, beforeTokens: value.before_tokens, provider: value.provider, modelId: value.model_id,
  leaseFence: value.lease_fence, leaseExpiresAt: value.lease_expires_at, failureCode: value.failure_code,
  committedSummaryRevision: value.committed_summary_revision, updatedAt: value.updated_at, terminalAt: value.terminal_at,
}; }
function toEvent(row: SqlRow): CompactionEvent { const value = EventRowSchema.parse(row); return {
  operationId: value.operation_id, operationSeq: value.operation_seq, characterId: value.character_id,
  attemptNo: value.attempt_no, kind: value.kind, occurredAt: value.occurred_at, failureCode: value.failure_code,
  summaryRevision: value.summary_revision, flushStatus: value.flush_status, writes: value.writes, outputChars: value.output_chars,
}; }
function leaseOf(input: z.infer<typeof BeginSchema>, attemptNo: number, fence: number): CompactionLease { return {
  operationId: input.operationId, characterId: input.characterId, owner: input.owner, fence, attemptNo, expiresAt: input.expiresAt,
}; }
function sameSource(operation: CompactionOperation, input: z.infer<typeof BeginSchema>): boolean { return operation.characterId === input.characterId
  && operation.selectedFromSeq === input.selectedFromSeq && operation.selectedThroughSeq === input.selectedThroughSeq
  && operation.expectedSummaryRevision === input.expectedSummaryRevision
  && operation.expectedSummaryThrough === input.expectedSummaryThrough && operation.sourceDigest === input.sourceDigest; }
