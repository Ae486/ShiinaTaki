/**
 * INPUT:  trusted primary persistence sessions from Chat, exact Timeline appends, candidate publication and explicit recovery
 * OUTPUT: atomic member custody per group, whole-group witness finalization, silent retraction and candidate relocation
 * POS:    core/db — only primary Chat enrolls groups; role labels and numeric ranges grant no provenance; no Run replay
 */
import { randomUUID } from "node:crypto";
import { TimelineEntrySchema, type TimelineEntry } from "@taki/shared";
import { primaryEntryDigest, type PrimaryConversationCommit } from "../memory/canonical-ingestion-source.ts";
import { createCanonicalIngestionSourceRepo } from "./canonical-ingestion-source-repo.ts";
import { canonicalMemoryAtomic } from "./canonical-memory-maintenance-storage.ts";
import { createHindsightIngestionSourceRepo } from "./hindsight-ingestion-source-repo.ts";
import type { Database, SqlRow } from "./sqlite.ts";
import type { TimelineRepo } from "./timeline-repo.ts";

export type PrimaryTimelineWriter = Pick<TimelineRepo, "append" | "deleteEntry">;
export interface PrimaryPersistenceSession {
  groupId: string;
  /** Appends register exact members in the same transaction; deleteEntry is the silent retraction of a user-only group. */
  repo: PrimaryTimelineWriter;
  /** Never throws: the terminal producer fact is durable even when the witness write fails, so recovery stays executable. */
  finalize(): void;
}
export interface PrimaryCustodyStatus { openGroups: number; recoverableGroups: number }
export interface PrimaryMemoryCustody {
  begin(input: { characterId: string; runId?: string; repo: PrimaryTimelineWriter }): PrimaryPersistenceSession;
  /** Finalizes only groups whose producer is proven dead (other boot) or settled; returns how many were closed. */
  reconcile(): number;
  status(): PrimaryCustodyStatus;
}
export interface PrimaryCustodyInput {
  db: Database;
  bootId: string;
  now?: () => string;
  /** Called with a closed code when a finalize could not write its witnesses; the group stays open and recoverable. */
  onFailure?: (input: { groupId: string; code: string }) => void;
}
type Custody = PrimaryCustodyInput & { now: () => string };

export function createPrimaryMemoryCustody(input: PrimaryCustodyInput): PrimaryMemoryCustody {
  const custody: Custody = { ...input, now: input.now ?? (() => new Date().toISOString()) };
  return {
    begin: (request) => begin(custody, request),
    reconcile: () => {
      let closed = 0;
      for (const row of openGroups(input.db)) {
        if (!recoverable(input.db, row, input.bootId)) continue;
        finalize(input.db, String(row.group_id), custody.now());
        closed += 1;
      }
      return closed;
    },
    status: () => {
      const rows = openGroups(input.db);
      return { openGroups: rows.length, recoverableGroups: rows.filter((row) => recoverable(input.db, row, input.bootId)).length };
    },
  };
}

function begin(custody: Custody, input: { characterId: string; runId?: string; repo: PrimaryTimelineWriter }): PrimaryPersistenceSession {
  const { db } = custody;
  const groupId = randomUUID();
  canonicalMemoryAtomic(db, () => {
    const candidate = currentCandidate(db);
    if (candidate) initializeEligibility(db, { ...candidate, characterId: input.characterId, now: custody.now() });
    db.prepare(`INSERT INTO primary_memory_groups
      (group_id,character_id,run_id,creator_boot_id,original_epoch_id,assigned_epoch_id,state,created_at)
      VALUES (:id,:character,:run,:boot,:epoch,:epoch,'open',:now)`)
      .run({ id: groupId, character: input.characterId, run: input.runId ?? null, boot: custody.bootId, epoch: candidate?.epoch ?? null, now: custody.now() });
  });
  const repo: PrimaryTimelineWriter = {
    append: (entry) => canonicalMemoryAtomic(db, () => {
      const group = requireOpen(db, groupId);
      if (entry.characterId !== group.character_id) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
      const saved = input.repo.append(entry);
      db.prepare("INSERT INTO primary_memory_members (group_id,timeline_seq,entry_id,entry_digest) VALUES (:group,:seq,:id,:digest)")
        .run({ group: groupId, seq: saved.seq, id: saved.id, digest: primaryEntryDigest(saved) });
      return saved;
    }),
    deleteEntry: (characterId, seq) => retract(db, { groupId, characterId, seq, repo: input.repo, now: custody.now() }),
  };
  return { groupId, repo, finalize: () => settle(custody, groupId) };
}

function settle(custody: Custody, groupId: string): void {
  custody.db.prepare("UPDATE primary_memory_groups SET producer_settled=1 WHERE group_id=:id AND state='open'").run({ id: groupId });
  try {
    finalize(custody.db, groupId, custody.now());
  } catch (error) {
    custody.onFailure?.({ groupId, code: failureCode(error) });
  }
}

function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.match(/^MEMORY_[A-Z_]+(?=:|$)/)?.[0] ?? "MEMORY_INGESTION_WITNESS_FAILED";
}

type EpochProvider = "local" | "hindsight";
interface EpochCandidate { epoch: string; provider: EpochProvider }

/** The committed Local or Hindsight epoch, or the selected candidate's epoch while it is the active canonical authority under Legacy. */
function currentCandidate(db: Database): EpochCandidate | null {
  const marker = db.prepare("SELECT mode,active_epoch_id FROM memory_authority_selection WHERE singleton=1").get();
  if (marker?.mode === "canonical-local") return { epoch: String(marker.active_epoch_id), provider: "local" };
  if (marker?.mode === "hindsight") return { epoch: String(marker.active_epoch_id), provider: "hindsight" };
  if (marker?.mode !== "legacy-markdown") return null;
  const row = db.prepare(`SELECT r.epoch_id FROM memory_migration_runs r JOIN memory_migration_candidates c ON c.run_id=r.run_id
    JOIN canonical_memory_authority_state s ON s.singleton=1 AND s.active_epoch_id=r.epoch_id
    WHERE c.superseded_by_run_id IS NULL AND r.status<>'completed' LIMIT 1`).get();
  return row ? { epoch: String(row.epoch_id), provider: "local" } : null;
}

/** Witness routing follows the assigned epoch's provider, so a group carried across COMMIT finalizes into the Hindsight table. */
function epochProvider(db: Database, epochId: string): EpochProvider {
  const row = db.prepare("SELECT provider_id FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: epochId });
  if (row?.provider_id !== "local" && row?.provider_id !== "hindsight") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  return row.provider_id;
}

function witness(db: Database, input: { candidate: EpochCandidate; commit: PrimaryConversationCommit; now: string }): void {
  if (input.candidate.provider === "local") createCanonicalIngestionSourceRepo(db).recordPrimaryCommitted({ ...input.commit, epochId: input.candidate.epoch });
  else createHindsightIngestionSourceRepo(db).recordPrimaryCommitted({ ...input.commit, epochId: input.candidate.epoch, now: input.now });
}

function requireOpen(db: Database, groupId: string): SqlRow {
  const row = db.prepare("SELECT * FROM primary_memory_groups WHERE group_id=:id").get({ id: groupId });
  if (!row || row.state !== "open" || row.producer_settled !== 0) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  return row;
}

/** Members re-read from the Timeline must still match their saved identity and digest; corruption blocks finalization. */
function exactMembers(db: Database, group: SqlRow): TimelineEntry[] {
  const rows = db.prepare(`SELECT m.entry_id AS member_id,m.entry_digest,t.* FROM primary_memory_members m
    LEFT JOIN timeline_messages t ON t.seq=m.timeline_seq WHERE m.group_id=:id ORDER BY m.timeline_seq`)
    .all({ id: String(group.group_id) });
  return rows.map((row) => {
    const parsed = TimelineEntrySchema.safeParse({ seq: row.seq, id: row.id, characterId: row.character_id, role: row.role,
      content: row.content, createdAt: row.created_at, parts: row.parts == null ? undefined : JSON.parse(String(row.parts)) });
    if (!parsed.success || parsed.data.characterId !== group.character_id || parsed.data.id !== row.member_id
      || primaryEntryDigest(parsed.data) !== row.entry_digest) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
    return parsed.data;
  });
}

function finalize(db: Database, groupId: string, now: string): void {
  db.transaction(() => {
    const group = db.prepare("SELECT * FROM primary_memory_groups WHERE group_id=:id").get({ id: groupId });
    if (!group) throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
    if (group.state !== "open") return;
    const entries = exactMembers(db, group);
    // An unassigned Legacy group closes its header only; a zero-member group leaves no witness and no boundary.
    if (entries.length > 0 && group.assigned_epoch_id !== null) {
      const epoch = String(group.assigned_epoch_id);
      witness(db, { candidate: { epoch, provider: epochProvider(db, epoch) }, now,
        commit: { characterId: String(group.character_id), entries, ...(group.run_id ? { runId: String(group.run_id) } : {}) } });
    }
    db.prepare(`UPDATE primary_memory_groups SET state=:state,producer_settled=1,finalized_through_seq=:seq,finalized_at=:now
      WHERE group_id=:id AND state='open'`)
      .run({ state: entries.length ? "finalized" : "closed-empty", seq: entries.at(-1)?.seq ?? null, now, id: groupId });
  });
}

function retract(db: Database, input: { groupId: string; characterId: string; seq: number; repo: PrimaryTimelineWriter; now: string }): void {
  db.transaction(() => {
    const group = requireOpen(db, input.groupId);
    const entries = exactMembers(db, group);
    if (group.character_id !== input.characterId || entries.length !== 1 || entries[0]?.seq !== input.seq) {
      throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
    }
    db.prepare("DELETE FROM primary_memory_members WHERE group_id=:id").run({ id: input.groupId });
    input.repo.deleteEntry(input.characterId, input.seq);
    db.prepare("UPDATE primary_memory_groups SET state='retracted',producer_settled=1,finalized_at=:now WHERE group_id=:id")
      .run({ now: input.now, id: input.groupId });
  });
}

function openGroups(db: Database): SqlRow[] {
  return db.prepare("SELECT * FROM primary_memory_groups WHERE state='open' ORDER BY created_at,group_id").all();
}

/** Dead = another boot created it; settled = this boot's producer already reported terminal, or its Harness Run is terminal. */
function recoverable(db: Database, row: SqlRow, bootId: string): boolean {
  if (row.creator_boot_id !== bootId || row.producer_settled === 1) return true;
  if (row.run_id === null) return false;
  return db.prepare("SELECT 1 FROM runs WHERE run_id=:run AND terminal_at IS NOT NULL").get({ run: String(row.run_id) }) !== undefined;
}

function initializeEligibility(db: Database, input: EpochCandidate & { characterId: string; now: string }): void {
  const throughSeq = Number(db.prepare("SELECT coalesce(max(seq),0) AS seq FROM timeline_messages WHERE character_id=:character")
    .get({ character: input.characterId })?.seq ?? 0);
  const scope = { epochId: input.epoch, characterId: input.characterId, throughSeq, now: input.now };
  if (input.provider === "local") createCanonicalIngestionSourceRepo(db).initializeBaseline(scope);
  else createHindsightIngestionSourceRepo(db).initializeBaseline(scope);
}

/** Runs inside candidate publication after the active pointer moved; adopts open groups and relocates unconsumed custody. */
export function assignPrimaryCandidate(db: Database, input: { epoch: string; previousEpoch: string | null; now: string }): void {
  if (input.previousEpoch) relocateUnconsumed(db, { previous: input.previousEpoch, epoch: input.epoch });
  const characters = db.prepare(`SELECT DISTINCT character_id FROM timeline_messages UNION SELECT character_id FROM primary_memory_groups
    UNION SELECT character_id FROM canonical_memory_banks WHERE authority_epoch_id=:epoch AND scope_kind='character'`).all({ epoch: input.epoch });
  for (const row of characters) initializeEligibility(db, { epoch: input.epoch, provider: "local", characterId: String(row.character_id), now: input.now });
  // Finalized groups that were never assigned are pre-boundary Legacy history; they are not adopted later.
  db.prepare(`UPDATE primary_memory_groups SET original_epoch_id=coalesce(original_epoch_id,:epoch),assigned_epoch_id=:epoch
    WHERE (state='open' AND assigned_epoch_id IS NULL) OR (assigned_epoch_id=:previous AND state IN ('open','finalized'))`)
    .run({ epoch: input.epoch, previous: input.previousEpoch });
}

/** A consumed span/receipt proves ingestion already happened; moving it would duplicate ingestion, so replacement refuses. */
function relocateUnconsumed(db: Database, input: { previous: string; epoch: string }): void {
  const claimed = db.prepare("SELECT 1 FROM canonical_memory_primary_commits WHERE authority_epoch_id=:previous AND ingestion_span_id IS NOT NULL LIMIT 1")
    .get({ previous: input.previous });
  if (claimed) throw new Error("MIGRATION_CANDIDATE_CONFLICT");
  db.prepare(`INSERT INTO canonical_memory_ingestion_cursors (authority_epoch_id,character_id,through_seq,eligibility_start_seq,updated_at)
    SELECT :epoch,character_id,through_seq,eligibility_start_seq,updated_at FROM canonical_memory_ingestion_cursors WHERE authority_epoch_id=:previous`)
    .run(input);
  db.prepare("UPDATE canonical_memory_primary_commits SET authority_epoch_id=:epoch WHERE authority_epoch_id=:previous AND ingestion_span_id IS NULL").run(input);
}
