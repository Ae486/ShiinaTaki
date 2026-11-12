/**
 * INPUT:  exact committed primary rows, active Local epochs, and completed ingestion claims
 * OUTPUT: durable unprocessed witnesses, immutable eligibility baselines, and guarded retirement coverage
 * POS:    core/db — source provenance and work queue; Timeline order is never a substitute for processing state
 */
import { TimelineEntrySchema, type TimelineEntry } from "@taki/shared";
import { z } from "zod";
import { assertCanonicalLocalAuthority, canonicalMemoryAtomic } from "./canonical-memory-maintenance-storage.ts";
import type { Database, SqlRow } from "./sqlite.ts";
import { heldEmergencyPrimaryMember } from "./memory-transition-held-primary.ts";
import { readTimelineSourceContext } from "./primary-source-row.ts";
import { firstPrimaryIngestionGroup, primaryIngestionCoverageGap } from "./primary-ingestion-progress.ts";
import { ingestionSourceDigest, primaryEntryDigest, sanitizeCommittedPrimarySpan,
  type IngestionCoverageGap, type PrimaryConversationCommit, type ProvenPrimaryEntry, type SanitizedCommittedSpan } from "../memory/canonical-ingestion-source.ts";

export interface IngestionScope { epochId: string; characterId: string }
type SourceRange = IngestionScope & { throughSeq: number };
type ClaimedSource = IngestionScope & { source: SanitizedCommittedSpan; spanId: string };
export interface CanonicalIngestionSourceRepo {
  recordPrimaryCommitted(input: PrimaryConversationCommit & { epochId?: string }): void;
  latestPrimarySeq(characterId: string): number;
  primaryEntries(input: { characterId: string; fromSeq: number; throughSeq: number }): ProvenPrimaryEntry[];
  pendingEntries(input: SourceRange): ProvenPrimaryEntry[];
  unprocessedCount(scope: IngestionScope): number;
  hasApplicableSource(input: SourceRange): boolean;
  cursor(scope: IngestionScope): number;
  eligibilityStartSeq(scope: IngestionScope): number | undefined;
  initializeBaseline(input: SourceRange & { now: string }): number;
  assertAvailable(input: IngestionScope & { source: SanitizedCommittedSpan }): void;
  claim(input: ClaimedSource): void;
  assertClaimed(input: ClaimedSource): void;
  advanceCoverage(input: SourceRange & { now: string }): number;
  coverageGap(input: SourceRange): IngestionCoverageGap | undefined;
}

const ScopeSchema = z.strictObject({ epochId: z.string().min(1).max(256), characterId: z.string().min(1).max(256) });
const WITNESS_SELECT = `SELECT t.*,p.entry_id AS witness_id,p.entry_digest,p.committed_through_seq,
  p.authority_epoch_id AS witness_epoch,p.ingestion_span_id FROM canonical_memory_primary_commits p
  JOIN timeline_messages t ON t.seq=p.timeline_seq`;

export function createCanonicalIngestionSourceRepo(db: Database): CanonicalIngestionSourceRepo {
  return {
    recordPrimaryCommitted: (input) => recordPrimary(db, input),
    latestPrimarySeq: (characterId) => Number(db.prepare(`SELECT COALESCE(MAX(timeline_seq),0) AS seq
      FROM canonical_memory_primary_commits WHERE character_id=:character AND authority_epoch_id=:epoch`)
      .get({ character: characterId, epoch: activeEpoch(db) })?.seq ?? 0),
    primaryEntries: (input) => readPrimary(db, input),
    pendingEntries: (input) => pendingEntries(db, input),
    unprocessedCount: (scope) => unprocessedCount(db, scope),
    hasApplicableSource: (input) => hasApplicableSource(db, input),
    cursor: (scope) => cursor(db, scope),
    eligibilityStartSeq: (scope) => eligibilityStartSeq(db, scope),
    initializeBaseline: (input) => initializeBaseline(db, input),
    assertAvailable: (input) => verifySource(db, input, null),
    claim: (input) => claim(db, input),
    assertClaimed: (input) => verifySource(db, input, input.spanId),
    advanceCoverage: (input) => advanceCoverage(db, input),
    coverageGap: (input) => coverageGap(db, input),
  };
}

export function assertCanonicalIngestionScope(db: Database, scope: IngestionScope): void {
  if (!ScopeSchema.safeParse({ epochId: scope.epochId, characterId: scope.characterId }).success) throw new Error("MEMORY_INVALID_REQUEST");
  assertCanonicalLocalAuthority(db, scope.epochId);
}

function activeEpoch(db: Database): string {
  const row = db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state WHERE singleton=1").get();
  const epoch = String(row?.active_epoch_id ?? "");
  assertCanonicalLocalAuthority(db, epoch);
  return epoch;
}

function recordPrimary(db: Database, input: PrimaryConversationCommit & { epochId?: string }): void {
  canonicalMemoryAtomic(db, () => {
    const epochId = input.epochId ?? activeEpoch(db);
    assertCanonicalIngestionScope(db, { epochId, characterId: input.characterId });
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
      if (heldEmergencyPrimaryMember(db, { targetEpochId: epochId, seq: entry.seq, entryId: entry.id, digest, characterId: entry.characterId })) continue;
      const prior = db.prepare("SELECT * FROM canonical_memory_primary_commits WHERE timeline_seq=:seq").get({ seq: entry.seq });
      if (prior) { verifyRepeatedCommit(db, { prior, entry, digest, input, epochId, throughSeq }); continue; }
      const hindsight = db.prepare("SELECT * FROM hindsight_ingestion_primary_commits WHERE timeline_seq=:seq").get({ seq: entry.seq });
      if (hindsight) {
        if (hindsight.entry_id !== entry.id || hindsight.entry_digest !== digest || hindsight.character_id !== input.characterId
          || hindsight.run_id !== (input.runId ?? null) || hindsight.committed_through_seq !== throughSeq) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
        const state = db.prepare(`SELECT state FROM hindsight_ingestion_spans WHERE authority_epoch_id=:epoch
          AND character_id=:character AND span_id=:span`).get({ epoch: String(hindsight.authority_epoch_id),
          character: input.characterId, span: hindsight.ingestion_span_id ?? null });
        if (state?.state !== "complete") throw new Error("MEMORY_AUTHORITY_MISMATCH");
        continue;
      }
      db.prepare(`INSERT INTO canonical_memory_primary_commits
        (timeline_seq,character_id,entry_id,entry_digest,run_id,committed_at,committed_through_seq,authority_epoch_id,ingestion_span_id)
        VALUES (:seq,:character,:id,:digest,:run,:at,:through,:epoch,NULL)`)
        .run({ seq: entry.seq, character: input.characterId, id: entry.id, digest, run: input.runId ?? null,
          at: new Date().toISOString(), through: throughSeq, epoch: epochId });
    }
  });
}

function verifyRepeatedCommit(db: Database, value: {
  prior: SqlRow; entry: TimelineEntry; digest: string; input: PrimaryConversationCommit; epochId: string; throughSeq: number;
}): void {
  const { prior, entry, digest, input, throughSeq } = value;
  if (prior.entry_id !== entry.id || prior.entry_digest !== digest || prior.run_id !== (input.runId ?? null)
    || prior.committed_through_seq !== throughSeq) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  if (prior.authority_epoch_id === value.epochId) return;
  const state = db.prepare(`SELECT state FROM canonical_memory_ingestion_spans WHERE
    authority_epoch_id=:epoch AND character_id=:character AND span_id=:span`)
    .get({ epoch: String(prior.authority_epoch_id), character: input.characterId, span: prior.ingestion_span_id ?? null });
  // A completed historical source is not a new occurrence after provider binding.
  // Unfinished old-epoch work requires the authority transition's explicit drain.
  if (state?.state !== "complete") throw new Error("MEMORY_AUTHORITY_MISMATCH");
}

function timelineEntry(row: SqlRow): TimelineEntry {
  try { return TimelineEntrySchema.parse({ seq: row.seq, id: row.id, characterId: row.character_id, role: row.role,
    content: row.content, createdAt: row.created_at, parts: row.parts == null ? undefined : JSON.parse(String(row.parts)),
    sourceContext: readTimelineSourceContext(row) }); }
  catch { throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN"); }
}

function proof(row: SqlRow, characterId: string): ProvenPrimaryEntry {
  const entry = timelineEntry(row);
  if (entry.characterId !== characterId || row.witness_id !== entry.id || row.entry_digest !== primaryEntryDigest(entry)) {
    throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  }
  return { kind: "primary-committed", entry, digest: String(row.entry_digest),
    committedThroughSeq: z.int().min(entry.seq).parse(row.committed_through_seq) };
}

function readPrimary(db: Database, input: { characterId: string; fromSeq: number; throughSeq: number }): ProvenPrimaryEntry[] {
  const epochId = activeEpoch(db);
  return db.prepare(`${WITNESS_SELECT} WHERE p.character_id=:character AND p.authority_epoch_id=:epoch
    AND p.timeline_seq>:after AND p.timeline_seq<=:through ORDER BY p.timeline_seq`)
    .all({ character: input.characterId, epoch: epochId, after: input.fromSeq, through: input.throughSeq }).map((row) => proof(row, input.characterId));
}

function pendingEntries(db: Database, input: SourceRange): ProvenPrimaryEntry[] {
  assertCanonicalIngestionScope(db, input);
  const entries = db.prepare(`${WITNESS_SELECT} WHERE p.character_id=:character AND p.authority_epoch_id=:epoch
    AND p.ingestion_span_id IS NULL AND p.timeline_seq<=:through ORDER BY p.timeline_seq LIMIT 257`)
    .all({ character: input.characterId, epoch: input.epochId, through: input.throughSeq }).map((row) => proof(row, input.characterId));
  return firstPrimaryIngestionGroup(db, entries);
}

function unprocessedCount(db: Database, scope: IngestionScope): number {
  assertCanonicalIngestionScope(db, scope);
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM canonical_memory_primary_commits
    WHERE authority_epoch_id=:epoch AND character_id=:character AND ingestion_span_id IS NULL`)
    .get({ epoch: scope.epochId, character: scope.characterId })?.count ?? 0);
}

function hasApplicableSource(db: Database, input: SourceRange): boolean {
  assertCanonicalIngestionScope(db, input);
  return db.prepare(`SELECT 1 AS present FROM canonical_memory_primary_commits
    WHERE authority_epoch_id=:epoch AND character_id=:character AND timeline_seq<=:through LIMIT 1`)
    .get({ epoch: input.epochId, character: input.characterId, through: input.throughSeq }) !== undefined;
}

function cursor(db: Database, scope: IngestionScope): number {
  assertCanonicalIngestionScope(db, scope);
  const row = baseline(db, scope);
  return row ? z.int().nonnegative().parse(row.through_seq) : 0;
}
function eligibilityStartSeq(db: Database, scope: IngestionScope): number | undefined {
  assertCanonicalIngestionScope(db, scope);
  const row = baseline(db, scope);
  return row ? z.int().positive().parse(row.eligibility_start_seq) : undefined;
}
function baseline(db: Database, scope: IngestionScope): SqlRow | undefined {
  return db.prepare(`SELECT through_seq,eligibility_start_seq FROM canonical_memory_ingestion_cursors
    WHERE authority_epoch_id=:epoch AND character_id=:character`).get({ epoch: scope.epochId, character: scope.characterId });
}

function initializeBaseline(db: Database, input: SourceRange & { now: string }): number {
  return canonicalMemoryAtomic(db, () => {
    assertCanonicalIngestionScope(db, input);
    const existing = eligibilityStartSeq(db, input);
    if (existing !== undefined) return existing;
    z.int().nonnegative().parse(input.throughSeq);
    const tail = Number(db.prepare(`SELECT COALESCE(MAX(seq),0) AS seq FROM timeline_messages
      WHERE character_id=:character`).get({ character: input.characterId })?.seq ?? 0);
    if (tail !== input.throughSeq) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
    db.prepare(`INSERT INTO canonical_memory_ingestion_cursors
      (authority_epoch_id,character_id,through_seq,eligibility_start_seq,updated_at) VALUES (:epoch,:character,0,:start,:at)`)
      .run({ epoch: input.epochId, character: input.characterId, start: tail + 1, at: input.now });
    return tail + 1;
  });
}

function coverageGap(db: Database, input: SourceRange): IngestionCoverageGap | undefined {
  assertCanonicalIngestionScope(db, input);
  const start = eligibilityStartSeq(db, input);
  if (start === undefined) throw new Error("MEMORY_INGESTION_BASELINE_MISSING");
  const gap = primaryIngestionCoverageGap(db, { ...input, provider: "local", eligibilityStartSeq: start });
  // Exact members of an unfinished custody group remain unfinalized even when a provider witness is already present.
  const open = db.prepare(`SELECT MIN(m.timeline_seq) AS seq FROM primary_memory_members m
    JOIN primary_memory_groups g ON g.group_id=m.group_id WHERE g.character_id=:character
    AND g.state='open' AND m.timeline_seq<=:through`).get({ character: input.characterId, through: input.throughSeq });
  return open?.seq != null && (!gap || Number(open.seq) <= gap.seq)
    ? { seq: Number(open.seq), code: "MEMORY_INGESTION_INCOMPLETE" } : gap;
}

function verifySource(db: Database, input: IngestionScope & { source: SanitizedCommittedSpan }, spanId: string | null): void {
  assertCanonicalIngestionScope(db, input);
  if (input.source.characterId !== input.characterId || input.source.proofs.length === 0) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  const entries = input.source.proofs.map((ref) => {
    const row = db.prepare(`${WITNESS_SELECT} WHERE p.timeline_seq=:seq AND p.authority_epoch_id=:epoch AND p.character_id=:character`)
      .get({ seq: ref.seq, epoch: input.epochId, character: input.characterId });
    if (!row || row.ingestion_span_id !== spanId || row.witness_id !== ref.id || row.entry_digest !== ref.digest) {
      throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
    }
    return proof(row, input.characterId);
  });
  const current = sanitizeCommittedPrimarySpan({ ...input.source, entries });
  if (ingestionSourceDigest(current) !== ingestionSourceDigest(input.source)) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
}

function claim(db: Database, input: ClaimedSource): void {
  canonicalMemoryAtomic(db, () => {
    for (const ref of input.source.proofs) {
      const result = db.prepare(`UPDATE canonical_memory_primary_commits SET ingestion_span_id=:span
        WHERE authority_epoch_id=:epoch AND character_id=:character AND timeline_seq=:seq
        AND entry_id=:id AND entry_digest=:digest AND ingestion_span_id IS NULL`)
        .run({ epoch: input.epochId, character: input.characterId, seq: ref.seq, id: ref.id, digest: ref.digest, span: input.spanId });
      if (result.changes !== 1) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
    }
  });
}

function advanceCoverage(db: Database, input: SourceRange & { now: string }): number {
  return canonicalMemoryAtomic(db, () => {
    assertCanonicalIngestionScope(db, input);
    const gap = coverageGap(db, input);
    const throughSeq = Math.min(input.throughSeq, gap ? gap.seq - 1 : input.throughSeq);
    const start = eligibilityStartSeq(db, input)!;
    if (throughSeq < start && !hasApplicableSource(db, { ...input, throughSeq })) return cursor(db, input);
    db.prepare(`UPDATE canonical_memory_ingestion_cursors SET through_seq=MAX(through_seq,:through),updated_at=:at
      WHERE authority_epoch_id=:epoch AND character_id=:character`)
      .run({ epoch: input.epochId, character: input.characterId, through: throughSeq, at: input.now });
    return cursor(db, input);
  });
}
