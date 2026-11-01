/**
 * INPUT: primary user input, actual response rows and admission-captured descriptive memory identity
 * OUTPUT: atomic retained/retracted sources, exact sealed reads and boot-only interrupted-input recovery
 * POS: core/db — provider-independent Timeline source owner; never settles Runs or checks provider availability
 */
import { randomUUID } from "node:crypto";
import { RunMemoryReferenceSchema, type RunMemoryReference, type TimelineEntry } from "@taki/shared";
import { z } from "zod";
import { ingestionContentHash, primaryEntryDigest } from "../memory/canonical-ingestion-source.ts";
import type { Database } from "./sqlite.ts";
import { prepareTimelineEntry, toEntry, type AppendInput, type TimelineRepo } from "./timeline-repo.ts";

const Id = z.string().min(1).max(256);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const SourceSchema = z.object({
  source_id: z.uuid(), character_id: Id, original_user_id: z.uuid(), original_user_seq: z.int().positive(),
  original_user_digest: Digest, run_id: Id.nullable(), memory_json: z.string().nullable(),
  state: z.enum(["open", "retained", "retracted"]), through_seq: z.int().positive().nullable(),
  source_digest: Digest.nullable(), created_at: z.iso.datetime(), closed_at: z.iso.datetime().nullable(),
});
type Source = z.infer<typeof SourceSchema>;
export const PrimarySourceMemoryIdentitySchema = RunMemoryReferenceSchema.pick({
  providerId: true, authorityEpochId: true, providerLineageId: true,
}).strip();
export type PrimarySourceMemoryIdentity = z.infer<typeof PrimarySourceMemoryIdentitySchema>;
const CapturedMemorySchema = z.union([RunMemoryReferenceSchema, PrimarySourceMemoryIdentitySchema.strict()]);
export interface RetainedPrimaryConversationSource {
  sourceId: string; characterId: string; userEntry: TimelineEntry; entries: TimelineEntry[];
  runId?: string; memory?: RunMemoryReference | PrimarySourceMemoryIdentity; throughSeq: number; digest: string;
}
export interface PrimaryConversationSourceRepo {
  begin(input: { user: AppendInput; runId?: string; memory?: RunMemoryReference }): { sourceId: string; userEntry: TimelineEntry };
  /** Returns response rows only; a duplicate never appends. */
  retain(input: { sourceId: string; rows: AppendInput[] }): { entries: TimelineEntry[]; committed: boolean };
  retract(sourceId: string): { userEntry?: TimelineEntry; committed: boolean };
  /** Call once during boot, before new primary dispatch can open sources. */
  recoverOpen(): { retainedSourceIds: string[]; unresolvedSourceIds: string[] };
  readRetained(sourceId: string): RetainedPrimaryConversationSource;
  listUnbound(input: { characterId: string; memory: PrimarySourceMemoryIdentity; limit?: number }): string[];
}
interface Dependencies { db: Database; timeline: TimelineRepo }

export function createPrimaryConversationSourceRepo(deps: Dependencies): PrimaryConversationSourceRepo {
  return {
    begin: (input) => begin(deps, input),
    retain: (input) => retain(deps, input),
    retract: (sourceId) => retract(deps, sourceId),
    recoverOpen: () => recoverOpen(deps),
    readRetained: (sourceId) => readRetained(deps.db, sourceId),
    listUnbound: (input) => listUnbound(deps.db, input),
  };
}

function begin(deps: Dependencies, input: Parameters<PrimaryConversationSourceRepo["begin"]>[0]) {
  if (input.user.role !== "user") throw new Error("PRIMARY_SOURCE_INVALID_INPUT");
  Id.parse(input.user.characterId);
  const runId = input.runId === undefined ? null : Id.parse(input.runId);
  const sourceId = randomUUID();
  let userEntry: TimelineEntry | undefined;
  deps.db.transaction(() => {
    const memory = input.memory === undefined
      ? (runId === null ? JSON.stringify(captureSelectedMemory(deps.db)) : null)
      : JSON.stringify(RunMemoryReferenceSchema.parse(input.memory));
    userEntry = deps.timeline.append(input.user);
    deps.db.prepare(`INSERT INTO primary_conversation_sources
      (source_id,character_id,original_user_id,original_user_seq,original_user_digest,run_id,memory_json,state,created_at)
      VALUES (:source,:character,:user,:seq,:digest,:run,:memory,'open',:at)`)
      .run({ source: sourceId, character: userEntry.characterId, user: userEntry.id, seq: userEntry.seq,
        digest: primaryEntryDigest(userEntry), run: runId, memory, at: new Date().toISOString() });
    link(deps.db, sourceId, [userEntry]);
  });
  if (!userEntry) throw new Error("PRIMARY_SOURCE_INVALID_INPUT");
  return { sourceId, userEntry };
}

function retain(deps: Dependencies, input: Parameters<PrimaryConversationSourceRepo["retain"]>[0]) {
  let entries: TimelineEntry[] = []; let committed = false;
  deps.db.transaction(() => {
    const source = readSource(deps.db, input.sourceId);
    if (source.state === "retracted") throw new Error("PRIMARY_SOURCE_CONFLICT");
    if (source.state === "retained") {
      entries = readRetained(deps.db, input.sourceId).entries.slice(1);
      assertRepeatedRows(entries, input.rows);
      return;
    }
    const original = readOpenUser(deps.db, source);
    if (input.rows.some((row) => row.characterId !== source.character_id || !["assistant", "tool"].includes(row.role))) {
      throw new Error("PRIMARY_SOURCE_INVALID_INPUT");
    }
    entries = deps.timeline.appendBatch(input.rows);
    link(deps.db, source.source_id, entries);
    seal(deps.db, source.source_id, [original, ...entries]);
    committed = true;
  });
  return { entries, committed };
}

function retract(deps: Dependencies, sourceId: string) {
  let userEntry: TimelineEntry | undefined; let committed = false;
  deps.db.transaction(() => {
    const source = readSource(deps.db, sourceId);
    if (source.state === "retained") throw new Error("PRIMARY_SOURCE_CONFLICT");
    if (source.state === "retracted") return;
    userEntry = readOpenUser(deps.db, source);
    deps.db.prepare("UPDATE primary_conversation_sources SET state='retracted',closed_at=:at WHERE source_id=:source")
      .run({ source: sourceId, at: new Date().toISOString() });
    deps.timeline.deleteEntry(userEntry.characterId, userEntry.seq);
    committed = true;
  });
  return { userEntry, committed };
}

function readSource(db: Database, sourceId: string): Source {
  const row = db.prepare("SELECT * FROM primary_conversation_sources WHERE source_id=:source").get({ source: sourceId });
  if (!row) throw new Error("PRIMARY_SOURCE_NOT_FOUND");
  return SourceSchema.parse(row);
}

function members(db: Database, source: Source): TimelineEntry[] {
  const entries = db.prepare("SELECT * FROM timeline_messages WHERE primary_source_id=:source ORDER BY seq")
    .all({ source: source.source_id }).map(toEntry);
  const user = entries[0];
  if (!user || user.id !== source.original_user_id || user.seq !== source.original_user_seq || user.role !== "user"
    || primaryEntryDigest(user) !== source.original_user_digest
    || entries.some((entry) => entry.characterId !== source.character_id)
    || entries.slice(1).some((entry) => !["assistant", "tool"].includes(entry.role))) {
    throw new Error("PRIMARY_SOURCE_UNPROVEN");
  }
  return entries;
}

function readOpenUser(db: Database, source: Source): TimelineEntry {
  const entries = members(db, source);
  const original = entries[0];
  // Responses and the seal commit together: an extra open member has no trustworthy completion boundary.
  if (entries.length !== 1 || !original) throw new Error("PRIMARY_SOURCE_UNPROVEN");
  return original;
}

function link(db: Database, sourceId: string, entries: TimelineEntry[]): void {
  const update = db.prepare(`UPDATE timeline_messages SET primary_source_id=:source
    WHERE id=:id AND seq=:seq AND character_id=:character AND primary_source_id IS NULL`);
  for (const entry of entries) {
    if (update.run({ source: sourceId, id: entry.id, seq: entry.seq, character: entry.characterId }).changes !== 1) {
      throw new Error("PRIMARY_SOURCE_UNPROVEN");
    }
  }
}

function memberDigest(entries: TimelineEntry[]): string {
  return ingestionContentHash(JSON.stringify(entries.map((entry) => ({ id: entry.id, seq: entry.seq, entryDigest: primaryEntryDigest(entry) }))));
}

function seal(db: Database, sourceId: string, entries: TimelineEntry[]): void {
  const throughSeq = entries.at(-1)?.seq;
  if (throughSeq === undefined) throw new Error("PRIMARY_SOURCE_UNPROVEN");
  db.prepare(`UPDATE primary_conversation_sources SET state='retained',through_seq=:through,source_digest=:digest,closed_at=:at
    WHERE source_id=:source AND state='open'`)
    .run({ source: sourceId, through: throughSeq, digest: memberDigest(entries), at: new Date().toISOString() });
  readRetained(db, sourceId);
}

function readRetained(db: Database, sourceId: string): RetainedPrimaryConversationSource {
  const source = readSource(db, sourceId);
  if (source.state !== "retained") throw new Error("PRIMARY_SOURCE_NOT_RETAINED");
  const entries = members(db, source); const userEntry = entries[0];
  if (!userEntry || source.through_seq === null || source.source_digest === null
    || entries.at(-1)?.seq !== source.through_seq || memberDigest(entries) !== source.source_digest) {
    throw new Error("PRIMARY_SOURCE_UNPROVEN");
  }
  return { sourceId, characterId: source.character_id, userEntry, entries,
    ...(source.run_id === null ? {} : { runId: source.run_id }),
    ...(source.memory_json === null ? {} : { memory: CapturedMemorySchema.parse(JSON.parse(source.memory_json)) }),
    throughSeq: source.through_seq, digest: source.source_digest };
}

function assertRepeatedRows(entries: TimelineEntry[], rows: AppendInput[]): void {
  const comparable = (entry: TimelineEntry) => JSON.stringify({ characterId: entry.characterId,
    role: entry.role, content: entry.content, parts: entry.parts, presentation: entry.presentation, sourceContext: entry.sourceContext });
  if (rows.length !== entries.length || rows.some((row, index) => {
    const entry = entries[index]; return !entry || comparable(prepareTimelineEntry(row)) !== comparable(entry);
  })) throw new Error("PRIMARY_SOURCE_CONFLICT");
}

function recoverOpen(deps: Dependencies): ReturnType<PrimaryConversationSourceRepo["recoverOpen"]> {
  const result = { retainedSourceIds: [] as string[], unresolvedSourceIds: [] as string[] };
  let after = 0;
  for (;;) {
    const rows = deps.db.prepare(`SELECT source_id,original_user_seq FROM primary_conversation_sources
      WHERE state='open' AND original_user_seq>:after ORDER BY original_user_seq LIMIT 256`).all({ after });
    if (rows.length === 0) return result;
    for (const row of rows) {
      const sourceId = String(row.source_id); after = Number(row.original_user_seq);
      try { retain(deps, { sourceId, rows: [] }); result.retainedSourceIds.push(sourceId); }
      catch { result.unresolvedSourceIds.push(sourceId); }
    }
  }
}

function captureSelectedMemory(db: Database): PrimarySourceMemoryIdentity {
  const row = db.prepare(`SELECT s.mode,s.active_epoch_id,s.provider_lineage_id AS selected_lineage,
    e.provider_id,e.provider_lineage_id,e.status FROM memory_authority_selection s
    LEFT JOIN canonical_memory_authority_epochs e ON e.epoch_id=s.active_epoch_id WHERE s.singleton=1`).get();
  if (row?.mode === "legacy-markdown" && row.active_epoch_id === null) return { providerId: "legacy-markdown" };
  const providerId = row?.mode === "canonical-local" ? "local" : row?.mode === "hindsight" ? "hindsight" : undefined;
  if (!row || !providerId || row.provider_id !== providerId || row.status !== "active"
    || typeof row.active_epoch_id !== "string" || typeof row.provider_lineage_id !== "string"
    || (providerId === "hindsight" && row.selected_lineage !== row.provider_lineage_id)) {
    throw new Error("PRIMARY_SOURCE_MEMORY_IDENTITY_UNPROVEN");
  }
  return PrimarySourceMemoryIdentitySchema.parse({ providerId, authorityEpochId: row.active_epoch_id,
    providerLineageId: row.provider_lineage_id });
}

function listUnbound(db: Database, input: Parameters<PrimaryConversationSourceRepo["listUnbound"]>[0]): string[] {
  const limit = z.int().min(1).max(256).parse(input.limit ?? 256);
  const memory = PrimarySourceMemoryIdentitySchema.parse(input.memory);
  return db.prepare(`SELECT s.source_id FROM primary_conversation_sources s
    WHERE s.character_id=:character AND s.state='retained'
    AND json_extract(s.memory_json,'$.providerId')=:provider
    AND json_extract(s.memory_json,'$.authorityEpochId') IS :epoch
    AND json_extract(s.memory_json,'$.providerLineageId') IS :lineage
    AND NOT EXISTS (SELECT 1 FROM timeline_messages t JOIN canonical_memory_primary_commits p ON p.timeline_seq=t.seq
      WHERE t.primary_source_id=s.source_id)
    AND NOT EXISTS (SELECT 1 FROM timeline_messages t JOIN hindsight_ingestion_primary_commits p ON p.timeline_seq=t.seq
      WHERE t.primary_source_id=s.source_id)
    ORDER BY s.original_user_seq LIMIT :limit`)
    .all({ character: Id.parse(input.characterId), provider: memory.providerId,
      epoch: memory.authorityEpochId ?? null, lineage: memory.providerLineageId ?? null, limit }).map((row) => String(row.source_id));
}
