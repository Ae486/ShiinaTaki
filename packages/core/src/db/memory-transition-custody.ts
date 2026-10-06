/**
 * INPUT:  selected source epoch and actual primary append, group, witness and ingestion producers
 * OUTPUT: exact outstanding custody snapshot and symmetric transfer inside authority publication
 * POS:    core/db — no Run replay; consumed spans remain historical and unfinished spans refuse healthy transfer
 */
import { TimelineEntrySchema, type MemoryTransitionCustody } from "@taki/shared";
import { primaryEntryDigest, SanitizedCommittedSpanSchema, ingestionSourceDigest } from "../memory/canonical-ingestion-source.ts";
import { canonicalIngestionIdentity } from "../memory/canonical-ingestion-plan.ts";
import { hindsightIngestionIdentity } from "../memory/hindsight/hindsight-ingestion-contract.ts";
import { exactMembers } from "./primary-memory-custody-repo.ts";
import type { Database, SqlRow } from "./sqlite.ts";
import { heldEmergencyPrimaryMember } from "./memory-transition-held-primary.ts";

const TABLES = {
  local: { witnesses: "canonical_memory_primary_commits", spans: "canonical_memory_ingestion_spans", cursors: "canonical_memory_ingestion_cursors" },
  hindsight: { witnesses: "hindsight_ingestion_primary_commits", spans: "hindsight_ingestion_spans", cursors: "hindsight_ingestion_cursors" },
} as const;

export function readTransitionCustody(db: Database, epochId: string): MemoryTransitionCustody {
  return readCustody(db, epochId, false);
}
/** Unknown original ingestion spans remain held under their original identity; only unconsumed witnesses transfer. */
export function readEmergencyTransitionCustody(db: Database, epochId: string): MemoryTransitionCustody {
  return readCustody(db, epochId, true);
}
function readCustody(db: Database, epochId: string, emergency: boolean): MemoryTransitionCustody {
  const provider = db.prepare("SELECT provider_id FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: epochId })?.provider_id;
  if (provider !== "local" && provider !== "hindsight") invalid();
  const tables = TABLES[provider];
  if (!emergency && db.prepare(`SELECT 1 FROM ${tables.spans} WHERE authority_epoch_id=:epoch AND state<>'complete' LIMIT 1`).get({ epoch: epochId })) {
    throw new Error("MEMORY_INGESTION_INCOMPLETE");
  }
  const witnesses = db.prepare(`SELECT * FROM ${tables.witnesses} WHERE authority_epoch_id=:epoch
    AND ingestion_span_id IS NULL ORDER BY timeline_seq`).all({ epoch: epochId }).map((row) => {
    const stored = db.prepare("SELECT * FROM timeline_messages WHERE seq=:seq").get({ seq: Number(row.timeline_seq) });
    if (!stored) invalid();
    const entry = TimelineEntrySchema.parse({ seq: stored.seq, id: stored.id, characterId: stored.character_id,
      role: stored.role, content: stored.content, createdAt: stored.created_at,
      parts: stored.parts == null ? undefined : JSON.parse(String(stored.parts)) });
    if (entry.id !== row.entry_id || entry.characterId !== row.character_id || primaryEntryDigest(entry) !== row.entry_digest) invalid();
    return { seq: entry.seq, entryId: entry.id, characterId: entry.characterId, digest: String(row.entry_digest),
      throughSeq: Number(row.committed_through_seq), runId: row.run_id === null ? null : String(row.run_id), committedAt: String(row.committed_at) };
  });
  const groups = db.prepare(`SELECT * FROM primary_memory_groups WHERE assigned_epoch_id=:epoch
    AND state IN ('open','finalized') ORDER BY group_id`).all({ epoch: epochId }).map((group) => ({
    groupId: String(group.group_id), characterId: String(group.character_id), state: group.state as "open" | "finalized",
    members: transitionMembers(db, tables, group),
  })).filter((group) => group.state === "open" || group.members.some((member) => witnesses.some((witness) => witness.seq === member.seq)));
  return { epochId, provider, groups, witnesses };
}

function transitionMembers(db: Database, tables: typeof TABLES[keyof typeof TABLES], group: SqlRow) {
  if (group.state === "open") return exactMembers(db, group).map((entry) => ({ seq: entry.seq, entryId: entry.id, digest: primaryEntryDigest(entry) }));
  const members = db.prepare("SELECT * FROM primary_memory_members WHERE group_id=:id ORDER BY timeline_seq").all({ id: String(group.group_id) });
  if (group.state === "finalized" && members.at(-1)?.timeline_seq !== group.finalized_through_seq) invalid();
  return members.map((member) => {
      // Compaction may already have retired the consumed portion of a finalized group. Its exact immutable member
      // digest plus completed ingestion span remains evidence; require live Timeline bytes for every outstanding row.
      const witness = db.prepare(`SELECT w.*,s.state AS span_state FROM ${tables.witnesses} w
        LEFT JOIN ${tables.spans} s ON s.span_id=w.ingestion_span_id AND s.authority_epoch_id=w.authority_epoch_id
          AND s.character_id=w.character_id WHERE w.timeline_seq=:seq`)
        .get({ seq: Number(member.timeline_seq) });
      const stored = db.prepare("SELECT * FROM timeline_messages WHERE seq=:seq").get({ seq: Number(member.timeline_seq) });
      const value = { seq: Number(member.timeline_seq), entryId: String(member.entry_id), digest: String(member.entry_digest) };
      if (!stored) {
        if (!completedMember(db, { ...value, characterId: String(group.character_id),
          epochIds: custodyAncestors(db, String(group.assigned_epoch_id)) })) invalid();
        return value;
      }
      if (!witness || witness.ingestion_span_id === null && witness.authority_epoch_id !== group.assigned_epoch_id) {
        if (!heldEmergencyPrimaryMember(db, { ...value, characterId: String(group.character_id), targetEpochId: String(group.assigned_epoch_id) })
          && !completedMember(db, { ...value, characterId: String(group.character_id),
          epochIds: custodyAncestors(db, String(group.assigned_epoch_id)) })) invalid();
        const entry = TimelineEntrySchema.parse({ seq: stored.seq, id: stored.id, characterId: stored.character_id,
          role: stored.role, content: stored.content, createdAt: stored.created_at,
          parts: stored.parts == null ? undefined : JSON.parse(String(stored.parts)) });
        if (primaryEntryDigest(entry) !== member.entry_digest) invalid();
        return value;
      }
      if (!witness || witness.entry_id !== member.entry_id || witness.entry_digest !== member.entry_digest
        || witness.character_id !== group.character_id) invalid();
      if (witness.span_state === "complete" && !completedMember(db, { ...value, characterId: String(group.character_id),
        epochIds: custodyAncestors(db, String(group.assigned_epoch_id)), spanId: String(witness.ingestion_span_id) })) invalid();
      // A selected target may already be ingesting its transferred rows during a status/boot read. Source publication
      // separately rejects unfinished spans above; only completed spans can replace compacted Timeline evidence.
      if (witness.span_state !== "complete") {
        if (witness.authority_epoch_id !== group.assigned_epoch_id
          || witness.ingestion_span_id !== null && witness.span_state == null) invalid();
        if (stored.id !== member.entry_id) invalid();
        const entry = TimelineEntrySchema.parse({ seq: stored.seq, id: stored.id, characterId: stored.character_id,
          role: stored.role, content: stored.content, createdAt: stored.created_at,
          parts: stored.parts == null ? undefined : JSON.parse(String(stored.parts)) });
        if (primaryEntryDigest(entry) !== member.entry_digest) invalid();
      }
      return value;
    });
}

function completedMember(db: Database, member: { seq: number; entryId: string; digest: string; characterId: string; epochIds: string[]; spanId?: string }): boolean {
  // Timeline compaction cascades witness deletion. The completed producer span retains its exact original source
  // proofs, including filtered messages, so neither role labels nor a numeric range is accepted as replacement evidence.
  for (const [provider, table] of Object.entries(TABLES)) {
    const spans = db.prepare(`SELECT * FROM ${table.spans} WHERE character_id=:character AND state='complete'
      AND from_seq<:seq AND through_seq>=:seq`).all({ character: member.characterId, seq: member.seq });
    for (const span of spans) {
      if (!member.epochIds.includes(String(span.authority_epoch_id)) || member.spanId !== undefined && span.span_id !== member.spanId) continue;
      const epoch = db.prepare("SELECT provider_id,provider_lineage_id FROM canonical_memory_authority_epochs WHERE epoch_id=:id")
        .get({ id: String(span.authority_epoch_id) });
      const identity = { epochId: String(span.authority_epoch_id), characterId: member.characterId, sourceHash: String(span.source_hash) };
      if (epoch?.provider_id !== provider || provider === "hindsight" && epoch.provider_lineage_id !== span.provider_lineage_id
        || span.span_id !== (provider === "local" ? canonicalIngestionIdentity(identity) : hindsightIngestionIdentity(identity))) invalid();
      const source = SanitizedCommittedSpanSchema.parse(JSON.parse(String(span.source_json)));
      if (source.characterId !== member.characterId || source.fromSeq !== span.from_seq || source.throughSeq !== span.through_seq
        || ingestionSourceDigest(source) !== span.source_hash) invalid();
      if (source.proofs.some((proof) => proof.seq === member.seq && proof.id === member.entryId && proof.digest === member.digest)) return true;
    }
  }
  return false;
}
function custodyAncestors(db: Database, epochId: string): string[] {
  const epochs: string[] = []; let current: string | null = epochId;
  while (current !== null) {
    if (epochs.includes(current)) invalid(); epochs.push(current);
    const epoch = db.prepare("SELECT predecessor_epoch_id FROM canonical_memory_authority_epochs WHERE epoch_id=:id").get({ id: current });
    if (!epoch) invalid(); current = epoch.predecessor_epoch_id === null ? null : String(epoch.predecessor_epoch_id);
  }
  return epochs;
}

/** Saved membership is a required subset: an open producer may append later, finalize, retract, or be ingested. */
export function verifyTransitionCustodyAssignment(db: Database, input: { source: MemoryTransitionCustody; targetEpochId: string }): void {
  const provider = input.source.provider === "local" ? "hindsight" : "local"; const tables = TABLES[provider];
  for (const saved of input.source.groups) {
    const group = db.prepare("SELECT * FROM primary_memory_groups WHERE group_id=:id").get({ id: saved.groupId });
    if (!group || group.assigned_epoch_id !== input.targetEpochId || group.character_id !== saved.characterId) invalid();
    if (group.state === "retracted" && saved.state === "open" && group.producer_settled === 1) {
      if (db.prepare("SELECT 1 FROM primary_memory_members WHERE group_id=:id").get({ id: saved.groupId })) invalid();
      continue;
    }
    const members = transitionMembers(db, tables, group);
    if (saved.members.some((member) => !members.some((current) => current.seq === member.seq
      && current.entryId === member.entryId && current.digest === member.digest))) invalid();
  }
  for (const saved of input.source.witnesses) {
    const stored = db.prepare("SELECT * FROM timeline_messages WHERE seq=:seq").get({ seq: saved.seq });
    if (!stored) {
      if (!completedMember(db, { ...saved, epochIds: [input.targetEpochId] })) invalid();
      continue;
    }
    const row = db.prepare(`SELECT w.*,s.state AS span_state FROM ${tables.witnesses} w
      LEFT JOIN ${tables.spans} s ON s.span_id=w.ingestion_span_id AND s.authority_epoch_id=w.authority_epoch_id
        AND s.character_id=w.character_id WHERE w.timeline_seq=:seq`).get({ seq: saved.seq });
    if (!row || row.authority_epoch_id !== input.targetEpochId || row.entry_id !== saved.entryId
      || row.entry_digest !== saved.digest || row.character_id !== saved.characterId
      || row.committed_through_seq !== saved.throughSeq || row.run_id !== saved.runId
      || row.ingestion_span_id !== null && row.span_state == null) invalid();
    if (row.span_state === "complete" && !completedMember(db, { ...saved, epochIds: [input.targetEpochId],
      spanId: String(row.ingestion_span_id) })) invalid();
    const entry = TimelineEntrySchema.parse({ seq: stored.seq, id: stored.id, characterId: stored.character_id,
      role: stored.role, content: stored.content, createdAt: stored.created_at,
      parts: stored.parts == null ? undefined : JSON.parse(String(stored.parts)) });
    if (entry.id !== saved.entryId || primaryEntryDigest(entry) !== saved.digest) invalid();
  }
}

/** The caller holds the outer writer transaction. A row from an earlier cycle may move only while still unconsumed. */
export function transferTransitionCustody(db: Database, input: { source: MemoryTransitionCustody; targetEpochId: string; now: string }): void {
  const provider = db.prepare("SELECT provider_id FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: input.targetEpochId })?.provider_id;
  if (provider !== "local" && provider !== "hindsight" || provider === input.source.provider) invalid();
  const tables = TABLES[provider];
  const characters = new Set([...input.source.groups.map((group) => group.characterId), ...input.source.witnesses.map((row) => row.characterId)]);
  for (const character of characters) {
    const tail = Number(db.prepare("SELECT coalesce(max(seq),0) AS n FROM timeline_messages WHERE character_id=:character").get({ character })?.n);
    db.prepare(`INSERT INTO ${tables.cursors}(authority_epoch_id,character_id,through_seq,eligibility_start_seq,updated_at)
      VALUES(:epoch,:character,0,:start,:now)`).run({ epoch: input.targetEpochId, character, start: tail + 1, now: input.now });
  }
  for (const witness of input.source.witnesses) {
    const previous = db.prepare(`SELECT * FROM ${tables.witnesses} WHERE timeline_seq=:seq`).get({ seq: witness.seq });
    if (previous && (previous.ingestion_span_id !== null || previous.entry_id !== witness.entryId
      || previous.entry_digest !== witness.digest || previous.committed_through_seq !== witness.throughSeq)) invalid();
    if (previous) db.prepare(`UPDATE ${tables.witnesses} SET authority_epoch_id=:epoch WHERE timeline_seq=:seq AND ingestion_span_id IS NULL`)
      .run({ epoch: input.targetEpochId, seq: witness.seq });
    else db.prepare(`INSERT INTO ${tables.witnesses}(timeline_seq,authority_epoch_id,character_id,entry_id,entry_digest,
      committed_through_seq,ingestion_span_id,run_id,committed_at) VALUES(:seq,:epoch,:character,:entry,:digest,:through,NULL,:run,:at)`)
      .run({ seq: witness.seq, epoch: input.targetEpochId, character: witness.characterId, entry: witness.entryId,
        digest: witness.digest, through: witness.throughSeq, run: witness.runId, at: witness.committedAt });
  }
  for (const group of input.source.groups) {
    if (db.prepare("UPDATE primary_memory_groups SET assigned_epoch_id=:epoch WHERE group_id=:group AND assigned_epoch_id=:previous")
      .run({ epoch: input.targetEpochId, group: group.groupId, previous: input.source.epochId }).changes !== 1) invalid();
  }
}
function invalid(): never { throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN"); }
