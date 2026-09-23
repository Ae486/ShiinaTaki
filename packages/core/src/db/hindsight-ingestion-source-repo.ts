/**
 * INPUT:  exact primary Timeline commits under one captured Hindsight authority epoch
 * OUTPUT: durable source witnesses, immutable eligibility baseline and claim/coverage checks
 * POS:    core/db — source provenance only; no Local ownership adaptation, native writes or model calls
 */
import { TimelineEntrySchema, type TimelineEntry } from "@taki/shared";
import { z } from "zod";
import type { Database, SqlRow } from "./sqlite.ts";
import { assertHindsightIngestionScope as assertScope, hindsightIngestionAtomic as atomic } from "./hindsight-ingestion-guard.ts";
import type { HindsightIngestionScope } from "../memory/hindsight/hindsight-ingestion-contract.ts";
import { ingestionSourceDigest, primaryEntryDigest, sanitizeCommittedPrimarySpan,
  type PrimaryConversationCommit, type ProvenPrimaryEntry, type SanitizedCommittedSpan } from "../memory/canonical-ingestion-source.ts";

type Range = HindsightIngestionScope & { throughSeq: number };
type Source = HindsightIngestionScope & { source: SanitizedCommittedSpan };
type Claim = Source & { spanId: string };
const WITNESS_SELECT = `SELECT t.*,p.entry_id AS witness_id,p.entry_digest,p.committed_through_seq,p.ingestion_span_id
 FROM hindsight_ingestion_primary_commits p JOIN timeline_messages t ON t.seq=p.timeline_seq`;

export function createHindsightIngestionSourceRepo(db: Database) {
  return {
    recordPrimaryCommitted: (input: PrimaryConversationCommit & HindsightIngestionScope & { now: string }) => recordPrimary(db, input),
    initializeBaseline: (input: Range & { now: string }) => initializeBaseline(db, input),
    eligibilityStartSeq: (scope: HindsightIngestionScope) => eligibilityStart(db, scope),
    cursor: (scope: HindsightIngestionScope) => cursor(db, scope),
    latestPrimarySeq: (scope: HindsightIngestionScope) => count(db, scope, { expression: "MAX(timeline_seq)" }),
    unprocessedCount: (scope: HindsightIngestionScope) => count(db, scope, { expression: "COUNT(*)", unassigned: true }),
    pendingEntries: (scope: Range) => pendingEntries(db, scope),
    hasApplicableSource: (scope: Range) => {
      assertScope(db, scope);
      return db.prepare(`SELECT 1 AS present FROM hindsight_ingestion_primary_commits WHERE authority_epoch_id=:epoch
        AND character_id=:character AND timeline_seq<=:through LIMIT 1`)
        .get({ epoch: scope.epochId, character: scope.characterId, through: scope.throughSeq }) !== undefined;
    },
    assertAvailable: (input: Source) => verifySource(db, input, null),
    assertClaimed: (input: Claim) => verifySource(db, input, input.spanId),
    claim: (input: Claim) => claim(db, input),
    assertCovered: (input: Range) => assertCovered(db, input),
    advanceCoverage: (input: Range & { now: string }) => advanceCoverage(db, input),
  };
}
export type HindsightIngestionSourceRepo = ReturnType<typeof createHindsightIngestionSourceRepo>;

function recordPrimary(db: Database, input: PrimaryConversationCommit & HindsightIngestionScope & { now: string }): void {
  atomic(db, input, () => {
    if (input.runId !== undefined && !z.string().min(1).max(256).safeParse(input.runId).success) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
    const throughSeq = input.entries.reduce((last, entry) => Math.max(last, entry.seq), 0);
    const seen = new Set<number>();
    for (const entry of input.entries) {
      if (entry.characterId !== input.characterId || seen.has(entry.seq)) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
      seen.add(entry.seq);
      const row = db.prepare("SELECT * FROM timeline_messages WHERE character_id=:character AND seq=:seq")
        .get({ character: input.characterId, seq: entry.seq });
      const digest = primaryEntryDigest(entry);
      if (!row || primaryEntryDigest(timelineEntry(row)) !== digest) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
      if (previousCommit(db, { input, entry, digest, throughSeq })) continue;
      db.prepare(`INSERT INTO hindsight_ingestion_primary_commits
        (timeline_seq,authority_epoch_id,character_id,entry_id,entry_digest,committed_through_seq,ingestion_span_id,run_id,committed_at)
        VALUES (:seq,:epoch,:character,:id,:digest,:through,NULL,:run,:at)`)
        .run({ seq: entry.seq, epoch: input.epochId, character: input.characterId, id: entry.id, digest,
          through: throughSeq, run: input.runId ?? null, at: input.now });
    }
  });
}

function previousCommit(db: Database, value: {
  input: PrimaryConversationCommit & HindsightIngestionScope; entry: TimelineEntry; digest: string; throughSeq: number;
}): boolean {
  const { input, entry, digest, throughSeq } = value;
  // A same-epoch Hindsight witness (including one carried from Local at activation) is this commit's own idempotent
  // replay and is checked first. A completed Local occurrence is historical evidence, not a new occurrence after
  // binding Hindsight. Reading its status does not invoke or relax any Local writer/authority guard.
  const hindsight = db.prepare("SELECT *, 'hindsight' AS source FROM hindsight_ingestion_primary_commits WHERE timeline_seq=:seq").get({ seq: entry.seq });
  const prior = hindsight?.authority_epoch_id === input.epochId ? hindsight
    : db.prepare("SELECT *, 'local' AS source FROM canonical_memory_primary_commits WHERE timeline_seq=:seq").get({ seq: entry.seq }) ?? hindsight;
  if (!prior) return false;
  if (prior.entry_id !== entry.id || prior.entry_digest !== digest || prior.character_id !== input.characterId
    || prior.run_id !== (input.runId ?? null) || prior.committed_through_seq !== throughSeq) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  if (prior.source === "hindsight" && prior.authority_epoch_id === input.epochId) return true;
  const table = prior.source === "local" ? "canonical_memory_ingestion_spans" : "hindsight_ingestion_spans";
  const state = db.prepare(`SELECT state FROM ${table} WHERE authority_epoch_id=:epoch AND character_id=:character AND span_id=:span`)
    .get({ epoch: String(prior.authority_epoch_id), character: input.characterId, span: prior.ingestion_span_id ?? null });
  if (state?.state !== "complete") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  return true;
}

function timelineEntry(row: SqlRow): TimelineEntry {
  try { return TimelineEntrySchema.parse({ seq: row.seq, id: row.id, characterId: row.character_id, role: row.role,
    content: row.content, createdAt: row.created_at, parts: row.parts == null ? undefined : JSON.parse(String(row.parts)) }); }
  catch { throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN"); }
}
function proof(row: SqlRow, characterId: string): ProvenPrimaryEntry {
  const entry = timelineEntry(row);
  if (entry.characterId !== characterId || row.witness_id !== entry.id || row.entry_digest !== primaryEntryDigest(entry)
    || !z.int().min(entry.seq).safeParse(row.committed_through_seq).success) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  return { kind: "primary-committed", entry, digest: String(row.entry_digest), committedThroughSeq: Number(row.committed_through_seq) };
}

function count(db: Database, scope: HindsightIngestionScope, input: { expression: "MAX(timeline_seq)" | "COUNT(*)"; unassigned?: boolean }): number {
  assertScope(db, scope);
  return Number(db.prepare(`SELECT COALESCE(${input.expression},0) AS n FROM hindsight_ingestion_primary_commits
    WHERE authority_epoch_id=:epoch AND character_id=:character ${input.unassigned ? "AND ingestion_span_id IS NULL" : ""}`)
    .get({ epoch: scope.epochId, character: scope.characterId })?.n ?? 0);
}

function pendingEntries(db: Database, scope: Range): ProvenPrimaryEntry[] {
  assertScope(db, scope); assertNoMissing(db, scope);
  return db.prepare(`${WITNESS_SELECT} WHERE p.authority_epoch_id=:epoch AND p.character_id=:character
    AND p.ingestion_span_id IS NULL AND p.timeline_seq<=:through ORDER BY p.timeline_seq LIMIT 257`)
    .all({ epoch: scope.epochId, character: scope.characterId, through: scope.throughSeq }).map((row) => proof(row, scope.characterId));
}

function baseline(db: Database, scope: HindsightIngestionScope): SqlRow | undefined {
  assertScope(db, scope);
  return db.prepare(`SELECT through_seq,eligibility_start_seq FROM hindsight_ingestion_cursors
    WHERE authority_epoch_id=:epoch AND character_id=:character`).get({ epoch: scope.epochId, character: scope.characterId });
}
function eligibilityStart(db: Database, scope: HindsightIngestionScope): number | undefined {
  const row = baseline(db, scope); return row ? z.int().positive().parse(row.eligibility_start_seq) : undefined;
}
function cursor(db: Database, scope: HindsightIngestionScope): number {
  const row = baseline(db, scope); return row ? z.int().nonnegative().parse(row.through_seq) : 0;
}

function initializeBaseline(db: Database, input: Range & { now: string }): number {
  return atomic(db, input, () => {
    const previous = eligibilityStart(db, input); if (previous !== undefined) return previous;
    z.int().nonnegative().parse(input.throughSeq);
    const tail = Number(db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM timeline_messages WHERE character_id=:character")
      .get({ character: input.characterId })?.seq ?? 0);
    if (tail !== input.throughSeq) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
    db.prepare(`INSERT INTO hindsight_ingestion_cursors (authority_epoch_id,character_id,through_seq,eligibility_start_seq,updated_at)
      VALUES (:epoch,:character,0,:start,:at)`)
      .run({ epoch: input.epochId, character: input.characterId, start: tail + 1, at: input.now });
    return tail + 1;
  });
}

function assertNoMissing(db: Database, input: Range): void {
  const start = eligibilityStart(db, input);
  if (start === undefined) throw new Error("MEMORY_INGESTION_BASELINE_MISSING");
  const missing = db.prepare(`SELECT 1 AS missing FROM timeline_messages t LEFT JOIN hindsight_ingestion_primary_commits p ON p.timeline_seq=t.seq
    WHERE t.character_id=:character AND t.seq>=:start AND t.seq<=:through AND t.role='user'
    AND (p.timeline_seq IS NULL OR p.authority_epoch_id<>:epoch) LIMIT 1`)
    .get({ character: input.characterId, epoch: input.epochId, start, through: input.throughSeq });
  if (missing) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
}

function verifySource(db: Database, input: Source, spanId: string | null): void {
  assertScope(db, input); assertNoMissing(db, { ...input, throughSeq: input.source.throughSeq });
  if (input.source.characterId !== input.characterId || !input.source.proofs.length) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  const entries = input.source.proofs.map((ref) => {
    const row = db.prepare(`${WITNESS_SELECT} WHERE p.timeline_seq=:seq AND p.authority_epoch_id=:epoch AND p.character_id=:character`)
      .get({ seq: ref.seq, epoch: input.epochId, character: input.characterId });
    if (!row || row.ingestion_span_id !== spanId || row.witness_id !== ref.id || row.entry_digest !== ref.digest) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
    return proof(row, input.characterId);
  });
  const actual = sanitizeCommittedPrimarySpan({ ...input.source, entries });
  if (ingestionSourceDigest(actual) !== ingestionSourceDigest(input.source)) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
}

function claim(db: Database, input: Claim): void {
  atomic(db, input, () => {
    verifySource(db, input, null);
    for (const ref of input.source.proofs) {
      const changed = db.prepare(`UPDATE hindsight_ingestion_primary_commits SET ingestion_span_id=:span WHERE authority_epoch_id=:epoch
        AND character_id=:character AND timeline_seq=:seq AND entry_id=:id AND entry_digest=:digest AND ingestion_span_id IS NULL`)
        .run({ epoch: input.epochId, character: input.characterId, seq: ref.seq, id: ref.id, digest: ref.digest, span: input.spanId });
      if (changed.changes !== 1) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
    }
  });
}

function assertCovered(db: Database, input: Range): void {
  assertScope(db, input); assertNoMissing(db, input);
  const pending = db.prepare(`SELECT 1 AS pending FROM hindsight_ingestion_primary_commits p LEFT JOIN hindsight_ingestion_spans s
    ON s.authority_epoch_id=p.authority_epoch_id AND s.character_id=p.character_id AND s.span_id=p.ingestion_span_id
    WHERE p.authority_epoch_id=:epoch AND p.character_id=:character AND p.timeline_seq<=:through
    AND (p.ingestion_span_id IS NULL OR s.state IS NULL OR s.state<>'complete') LIMIT 1`)
    .get({ epoch: input.epochId, character: input.characterId, through: input.throughSeq });
  if (pending) throw new Error("MEMORY_INGESTION_INCOMPLETE");
}

function advanceCoverage(db: Database, input: Range & { now: string }): number {
  return atomic(db, input, () => {
    assertCovered(db, input);
    const start = eligibilityStart(db, input);
    if (start === undefined) throw new Error("MEMORY_INGESTION_BASELINE_MISSING");
    if (input.throughSeq < start) return cursor(db, input);
    db.prepare(`UPDATE hindsight_ingestion_cursors SET through_seq=MAX(through_seq,:through),updated_at=:at
      WHERE authority_epoch_id=:epoch AND character_id=:character`)
      .run({ epoch: input.epochId, character: input.characterId, through: input.throughSeq, at: input.now });
    return cursor(db, input);
  });
}
