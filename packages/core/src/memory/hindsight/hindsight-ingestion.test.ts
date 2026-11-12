import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import type { CanonicalMemoryBank, MemoryReplicaBank, MemoryResult, RetainRequest, RetainResult } from "@taki/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";
import { createPrimaryConversationSourceRepo } from "../../db/primary-conversation-source-repo.ts";
import { createPrimaryMemoryCustody } from "../../db/primary-memory-custody-repo.ts";
import { primaryEntryDigest, sanitizeCommittedPrimarySpan } from "../canonical-ingestion-source.ts";
import { readPrimaryMemorySource } from "../../db/primary-memory-source-read.ts";
import { primarySourceRowDigest } from "../../db/primary-source-row.ts";
import { createMemoryRunReference } from "../memory-capability-snapshot.ts";
import { createPendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import { pendingMemoryRef } from "../../db/pending-memory-store.ts";
import { createHindsightIngestionRepo } from "../../db/hindsight-ingestion-repo.ts";
import { createReplicaRecordStore } from "../../db/hindsight-replica-record-store.ts";
import { publishReplicaCheckpoint, readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { scriptedGenerateModel, failingGenerateModel } from "../../testing/mock-language-model.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { createIntlSegmenterTokenizer } from "../search-tokenizer.ts";
import { createUtilitySlot } from "../utility-slot.ts";
import { createPendingMemoryWriter } from "../pending-memory-writer.ts";
import type { MemoryProviderCallContext } from "../memory-provider.ts";
import { createHindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import { loadMemoryConfig } from "../../config/memory-config.ts";
import { createHindsightIngestion } from "./hindsight-ingestion.ts";
import type { HindsightIngestionBankReader } from "../../db/hindsight-ingestion-guard.ts";

const AT = "2026-09-11T00:00:00.000Z";
const LINEAGE = "11111111-1111-4111-8111-111111111111";
const GENERATION = "22222222-2222-4222-8222-222222222222";
const EPOCH = "hindsight-epoch";
const BANKS: MemoryReplicaBank[] = [
  { bankId: "native-global", scope: "global", characterId: null },
  { bankId: "native-taki", scope: "character", characterId: "taki" },
  { bankId: "native-other", scope: "character", characterId: "other" },
];
const caps = { providerId: "hindsight", contractVersion: 1 as const, retain: true, recall: true, reflect: false,
  edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true,
  sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: true };
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
function script(...values: unknown[]) { return scriptedGenerateModel(values.map((value) => ({ kind: "text", deltas: [JSON.stringify(value)] }))); }
function keep(route: "global" | "character" | "both" = "character", fromSeq = 1, throughSeq = 2) { return { decision: "keep", route, fromSeq, throughSeq }; }
function retirement(throughSeq: number) { return { characterId: "taki", fromSeq: 1, throughSeq, operationId: `retirement:${throughSeq}` }; }
function tempPath() { const root = mkdtempSync(join(tmpdir(), "taki-hindsight-ingestion-")); cleanup.push(() => rmTempDir(root)); return join(root, "memory.sqlite"); }

function bankRecord(bank: MemoryReplicaBank): CanonicalMemoryBank {
  return { authorityEpochId: EPOCH, bankId: bank.bankId,
    scope: bank.scope === "global" ? { kind: "global", characterId: null } : { kind: "character", characterId: bank.characterId! },
    name: bank.bankId, disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "fixture", config: {},
    revision: 1, createdAt: AT, updatedAt: AT };
}
function seed(db: Database) {
  if (!db.prepare("SELECT epoch_id FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: EPOCH })) {
    db.prepare(`INSERT INTO canonical_memory_authority_epochs
      (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES (:epoch,'hindsight',:lineage,'active',NULL,:at,NULL,'planned-switch')`).run({ epoch: EPOCH, lineage: LINEAGE, at: AT });
    db.prepare(`INSERT INTO canonical_memory_authority_state(singleton,active_epoch_id,updated_at) VALUES (1,:epoch,:at)
      ON CONFLICT(singleton) DO UPDATE SET active_epoch_id=excluded.active_epoch_id,updated_at=excluded.updated_at`).run({ epoch: EPOCH, at: AT });
  }
  const records = createReplicaRecordStore(db, createIntlSegmenterTokenizer({ stoplist: true }));
  for (const bank of BANKS) if (!readReplicaCheckpoint(db, bank.bankId)) db.transaction(() => {
    records.write({ bankId: bank.bankId, objectKind: "bank", objectId: bank.bankId, objectRevision: 1,
      operation: "upsert", payload: { kind: "bank", value: bankRecord(bank) } }, null);
    publishReplicaCheckpoint(db, { previous: null, next: { providerLineageId: LINEAGE, bankId: bank.bankId,
      bankGeneration: GENERATION, authorityEpochId: EPOCH, replicaEpochId: GENERATION, endCursor: 0,
      snapshotId: LINEAGE, snapshotCursor: 0, snapshotManifestDigest: "a".repeat(64), manifestDigest: records.digest(bank.bankId), verifiedAt: AT } });
  });
}

function fixture(model: LanguageModel, path = ":memory:", readVerifiedBank?: HindsightIngestionBankReader["readVerifiedBank"]) {
  const db = openDatabase({ path, migrations: MIGRATIONS });
  let closed = false; const close = () => { if (!closed) { closed = true; db.close(); } }; cleanup.push(close);
  seed(db);
  const authority = createCanonicalMemoryAuthorityRepo(db); const timeline = createTimelineRepo(db);
  const primarySources = createPrimaryConversationSourceRepo({ db, timeline });
  const memory = createMemoryRunReference({ providerId: "hindsight", providerLineageId: LINEAGE,
    authorityEpochId: EPOCH, contractVersion: 1, capabilities: caps });
  const pending = createPendingMemoryRepo(db, () => AT);
  const replica = createHindsightReplicaSyncRepo({ db, tokenizer: createIntlSegmenterTokenizer({ stoplist: true }),
    projection: { bankScope: (bankId) => bankRecord(BANKS.find((bank) => bank.bankId === bankId)!).scope,
      source: () => { throw new Error("fixture never hydrates native sources"); },
      memory: () => { throw new Error("fixture never hydrates native memories"); } }, now: () => AT });
  const writer = createPendingMemoryWriter({ authority, replica, pending, now: () => AT });
  const journal = createHindsightIngestionRepo({ db, pending, readVerifiedBank });
  const captured = createCaptureLogger(); const slot = createUtilitySlot({ mainModel: model, logger: captured.logger });
  const failedBanks = new Set<string>();
  let mode: "queue" | "promise" | "completed" | "lost-ack" = "queue";
  let transform: ((result: MemoryResult<RetainResult>) => unknown) | undefined;
  const retain = vi.fn(async (context: MemoryProviderCallContext, request: RetainRequest): Promise<MemoryResult<RetainResult>> => {
    if (failedBanks.has(request.bankId)) throw new Error("PRIVATE_QUEUE_FAILURE");
    let data: RetainResult;
    if (mode === "completed") data = { status: "completed", documentId: request.documentId!, sourceRevision: 1, memories: [], zeroResult: true };
    else {
      if (mode !== "promise") writer.enqueue({ kind: "retain", request, zeroResultAllowed: true }, context, BANKS.find((bank) => bank.bankId === request.bankId)!);
      if (mode === "lost-ack") throw new Error("PRIVATE_LOST_ACK");
      data = { status: "pending", operationId: context.requestId, documentId: request.documentId, sourceRevision: null, memories: [] };
    }
    const result: MemoryResult<RetainResult> = { ok: true, requestId: context.requestId, providerId: "hindsight", authorityEpochId: EPOCH, capabilities: caps, data };
    return transform ? transform(result) as MemoryResult<RetainResult> : result;
  });
  const ingestion = createHindsightIngestion({ authority, journal, timeline, slot, provider: { retain },
    resolveBanks: (characterId) => BANKS.filter((bank) => bank.scope === "global" || bank.characterId === characterId),
    config: loadMemoryConfig({}), now: () => AT, primarySources });
  cleanup.push(() => ingestion.stop());
  const scope = { epochId: EPOCH, characterId: "taki" };
  const primary = (user = "The user prefers quiet cafes.", assistant = "I will remember that preference.") => {
    const entries = [timeline.append({ characterId: "taki", role: "user", content: user }),
      timeline.append({ characterId: "taki", role: "assistant", content: assistant })];
    ingestion.recordPrimaryCommitted({ characterId: "taki", entries }); return entries;
  };
  return { db, close, authority, timeline, pending, writer, journal, slot, retain, ingestion, scope, primary, primarySources, memory, failedBanks,
    logs: captured.records, mode: (value: typeof mode) => { mode = value; }, transform: (value: typeof transform) => { transform = value; } };
}

describe("Hindsight original-source ingestion and flush", () => {
  it("binds retained sources after restart without native calls and preserves source receipt compatibility", async () => {
    const path = tempPath(); const initial = fixture(script(), path); initial.ingestion.initializeBaseline("taki");
    const source = initial.primarySources.begin({ user: { characterId: "taki", role: "user", content: "Quiet cafes are best" }, memory: initial.memory });
    initial.primarySources.retain({ sourceId: source.sourceId, rows: [{ characterId: "taki", role: "assistant", content: "noted" }] });
    await initial.ingestion.stop(); initial.close();
    const model = script(keep()); const f = fixture(model, path);
    expect(f.ingestion.importPrimarySources("taki")).toEqual({ imported: 1, unresolvedSourceIds: [] });
    const witnesses = f.db.prepare("SELECT * FROM hindsight_ingestion_primary_commits ORDER BY timeline_seq").all();
    expect(witnesses.map((row) => row.committed_through_seq)).toEqual([2, 2]);
    expect(f.ingestion.importPrimarySources("taki")).toEqual({ imported: 0, unresolvedSourceIds: [] });
    expect(f.retain).not.toHaveBeenCalled(); expect(model.doGenerateCalls).toHaveLength(0);
    expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 1, pendingSources: 1, throughSeq: 2 });
    const receipt = f.db.prepare("SELECT * FROM hindsight_ingestion_spans").all();
    const row = f.db.prepare("SELECT * FROM timeline_messages WHERE id=:id").get({ id: source.userEntry.id })!;
    expect(readPrimaryMemorySource(f.db, { characterId: "taki", userTimelineId: source.userEntry.id,
      userTimelineSeq: source.userEntry.seq, sourceDigest: primarySourceRowDigest(row) }).kind).toBe("hindsight");
    expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 0, throughSeq: 2 });
    expect(f.db.prepare("SELECT * FROM hindsight_ingestion_spans").all()).toEqual(receipt);
    expect(f.retain).toHaveBeenCalledTimes(1); expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("imports before cadence while leaving absent and changed authority captures unbound", async () => {
    const model = script({ decision: "skip" }); const f = fixture(model); f.ingestion.initializeBaseline("taki");
    for (const memory of [undefined, { ...f.memory, authorityEpochId: "different-epoch" },
      { ...f.memory, providerLineageId: "other-lineage" }]) {
      const source = f.primarySources.begin({ user: { characterId: "taki", role: "user", content: "unmatched origin" }, memory,
        runId: memory ? undefined : "run-without-memory-snapshot" });
      f.primarySources.retain({ sourceId: source.sourceId, rows: [] });
    }
    for (let i = 0; i < 10; i += 1) {
      const source = f.primarySources.begin({ user: { characterId: "taki", role: "user", content: `known ${i}` },
        memory: i === 0 ? createMemoryRunReference({ ...f.memory, capabilities: { ...f.memory.capabilities, reflect: true } }) : f.memory });
      f.primarySources.retain({ sourceId: source.sourceId, rows: [{ characterId: "taki", role: "assistant", content: "noted" }] });
    }
    expect(await f.ingestion.maybeRun({ characterId: "taki" })).toMatchObject({ skippedSpans: 1, throughSeq: 0,
      sourceImport: { imported: 10 }, coverageGap: { seq: 1, code: "MEMORY_INGESTION_SOURCE_UNPROVEN" } });
    expect(model.doGenerateCalls).toHaveLength(1); expect(f.retain).not.toHaveBeenCalled();
  });

  it("processes known groups on both sides of an unresolved hole with conservative coverage", async () => {
    const model = script(keep("character", 1, 2), keep("character", 4, 7));
    const f = fixture(model); f.ingestion.initializeBaseline("taki"); f.primary("first source", "noted");
    f.timeline.append({ characterId: "taki", role: "user", content: "unexplained hole" });
    f.primary("second source", "noted"); f.primary("third source", "noted");
    expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 2, pendingSources: 2, throughSeq: 2,
      coverageGap: { seq: 3, code: "MEMORY_INGESTION_SOURCE_UNPROVEN" } });
    expect(f.retain.mock.calls.map((call) => call[1].content)).toEqual(["first source\nnoted", "second source\nnoted\nthird source\nnoted"]);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 0, throughSeq: 2, coverageGap: { seq: 3 } });
    expect(f.journal.cursor(f.scope)).toBe(2);
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(7))).toMatchObject({ status: "retryable_failure" });
    const later = f.pending.list({ authorityEpochId: EPOCH, bankId: "native-taki" }).at(-1)!;
    f.pending.cancelQueued(pendingMemoryRef(later));
    await expect(f.ingestion.run({ characterId: "taki" })).rejects.toThrow("MEMORY_INGESTION_RECEIPT_UNPROVEN");
    expect(f.journal.cursor(f.scope)).toBe(2);
    expect(f.retain).toHaveBeenCalledTimes(2);
  });

  it("refuses a supplied source span that bridges an unproven user occurrence", () => {
    const model = script(keep()); const f = fixture(model); f.ingestion.initializeBaseline("taki");
    const first = f.primary("first source", "noted");
    f.timeline.append({ characterId: "taki", role: "user", content: "unexplained hole" });
    const second = f.primary("second source", "noted");
    const source = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: 5,
      entries: [...first, ...second].map((entry) => ({ kind: "primary-committed", entry,
        digest: primaryEntryDigest(entry), committedThroughSeq: entry.seq <= 2 ? 2 : 5 })) });
    expect(() => f.journal.start({ ...f.scope, source, now: AT })).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_ingestion_spans").get()?.n).toBe(0);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("refuses pre-baseline and previously covered retirement while exact custody remains unsettled", async () => {
    const f = fixture(script({ decision: "skip" }, { decision: "skip" }));
    const custody = createPrimaryMemoryCustody({ db: f.db, bootId: "before-memory", now: () => AT });
    const session = custody.begin({ characterId: "taki", repo: f.timeline });
    session.repo.append({ characterId: "taki", role: "assistant", content: "original unsettled answer" });
    f.ingestion.initializeBaseline("taki");
    expect(f.journal.eligibilityStartSeq(f.scope)).toBe(2);
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(1))).toMatchObject({ status: "retryable_failure" });
    expect(f.journal.cursor(f.scope)).toBe(0);
    session.finalize();
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(1))).toMatchObject({ status: "not_required" });
    f.primary(); await f.ingestion.run({ characterId: "taki" });
    expect(f.journal.cursor(f.scope)).toBe(3);
    const late = custody.begin({ characterId: "taki", repo: f.timeline });
    const entry = late.repo.append({ characterId: "taki", role: "assistant", content: "late unfinalized answer" });
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: [entry] });
    expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ throughSeq: 3,
      coverageGap: { seq: 4, code: "MEMORY_INGESTION_INCOMPLETE" } });
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(4))).toMatchObject({ status: "retryable_failure" });
    expect(f.journal.cursor(f.scope)).toBe(3);
  });

  it("uses one gate/Utility Slot call and actual Pending coverage without Local fact extraction", async () => {
    const model = script(keep()); const f = fixture(model); f.ingestion.initializeBaseline("taki"); const entries = f.primary();
    const result = await f.ingestion.run({ characterId: "taki" });
    expect(result).toMatchObject({ throughSeq: 2, writes: 1, sources: 1, pendingSources: 1, confirmedSources: 0 });
    expect(model.doGenerateCalls).toHaveLength(1); expect(f.slot.usage().calls).toBe(1);
    expect(JSON.stringify(model.doGenerateCalls)).toContain("Do not summarize, extract facts");
    const row = f.pending.list({ authorityEpochId: EPOCH, bankId: "native-taki" })[0]!;
    expect(row.phase).toBe("queued"); expect(row.nativeReceipt).toBeNull();
    expect(row.intent.operation).toMatchObject({ kind: "retain", request: { content: entries.map((entry) => entry.content).join("\n"),
      policy: { layerId: "unclassified", visibility: "retrieved" }, provenance: { origin: "auto-gate", characterId: "taki",
        timelineFromSeq: 1, timelineToSeq: 2, capturedAt: entries[1]!.createdAt } } });
    if (row.intent.operation.kind !== "retain") throw new Error("fixture kind");
    expect(row.intent.operation.request.metadata["taki:conversation-source:v1"]).toMatchObject({ entries: entries.map((entry, index) => ({
      id: entry.id, seq: entry.seq, role: entry.role, createdAt: entry.createdAt,
      utf16Start: index === 0 ? 0 : entries[0]!.content.length + 1, utf16Length: entry.content.length,
    })) });
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM canonical_memory_units").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM hindsight_replica_sync_fts").get()?.n).toBe(0);
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "success", writes: 0 });
    expect(f.retain).toHaveBeenCalledTimes(1);
  });

  it.each(["global", "character", "both"] as const)("persists the complete %s Bank plan before dispatch", async (route) => {
    const f = fixture(script(keep(route))); f.ingestion.initializeBaseline("taki"); f.primary();
    const original = f.retain.getMockImplementation()!;
    f.retain.mockImplementation(async (context, request) => {
      const state = f.journal.pending(f.scope)!;
      expect(state.gate).toEqual(keep(route)); expect(state.batches).toHaveLength(route === "both" ? 2 : 1);
      expect(state.batches.find((batch) => batch.requestId === context.requestId)?.request).toEqual(request);
      return original(context, request);
    });
    const result = await f.ingestion.run({ characterId: "taki" });
    expect(result.writes).toBe(route === "both" ? 2 : 1);
    expect(f.retain.mock.calls.map(([, request]) => request.bankId)).toEqual(route === "both"
      ? ["native-global", "native-taki"] : [route === "global" ? "native-global" : "native-taki"]);
    expect(f.pending.list({ authorityEpochId: EPOCH, bankId: "native-other" })).toEqual([]);
  });

  it("excludes hidden/derived envelopes, tool payloads, credentials and autonomous rows before all durable source writes", async () => {
    const model = script(keep("both", 1, 2)); const f = fixture(model); f.ingestion.initializeBaseline("taki");
    const user = f.timeline.append({ characterId: "taki", role: "user", content: "Original user wording.<turn-context>PRIVATE_RECALL</turn-context>" });
    const assistant = f.timeline.append({ characterId: "taki", role: "assistant", content: "PRIVATE_DISPLAY", parts: [
      { type: "text", text: "Original assistant wording." }, { type: "tool-call", toolCallId: "call", toolName: "recall", input: "PRIVATE_INPUT" },
    ] });
    const tool = f.timeline.append({ characterId: "taki", role: "tool", content: "PRIVATE_TOOL_OUTPUT" });
    f.timeline.append({ characterId: "taki", role: "assistant", content: "PRIVATE_AUTONOMOUS" });
    const secret = f.timeline.append({ characterId: "taki", role: "user", content: "api_key=PRIVATE_SECRET_123456789" });
    const hidden = f.timeline.append({ characterId: "taki", role: "user", content: "<conversation-summary>PRIVATE_SUMMARY</conversation-summary>" });
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: [user, assistant, tool, secret, hidden] });
    await f.ingestion.run({ characterId: "taki" });
    const stored = JSON.stringify(f.db.prepare("SELECT source_json,batches_json FROM hindsight_ingestion_spans").all())
      + JSON.stringify(f.db.prepare("SELECT state_json FROM pending_memory").all());
    expect(stored).toContain("Original user wording."); expect(stored).toContain("Original assistant wording.");
    expect(stored).not.toContain("PRIVATE_"); expect(JSON.stringify(model.doGenerateCalls)).not.toContain("PRIVATE_");
    expect(JSON.stringify(f.logs)).not.toContain("PRIVATE_");
  });

  it("uses the existing twenty-primary-message cadence and lets a forced flush process a smaller span", async () => {
    const model = script({ decision: "skip" }, { decision: "skip" }); const f = fixture(model);
    f.ingestion.initializeBaseline("taki"); f.ingestion.initializeBaseline("other");
    for (let index = 0; index < 30; index += 1) f.timeline.append({ characterId: "taki", role: "assistant", content: "AUTONOMOUS_NOT_PRIMARY" });
    for (let index = 0; index < 9; index += 1) f.primary();
    const other = f.timeline.append({ characterId: "other", role: "user", content: "OTHER_CHARACTER" });
    f.ingestion.recordPrimaryCommitted({ characterId: "other", entries: [other] });
    expect(f.journal.unprocessedCount(f.scope)).toBe(18);
    expect(await f.ingestion.maybeRun({ characterId: "taki" })).toBeNull(); expect(model.doGenerateCalls).toHaveLength(0);
    f.primary(); expect(await f.ingestion.maybeRun({ characterId: "taki" })).toMatchObject({ skippedSpans: 1, writes: 0 });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(model.doGenerateCalls)).not.toMatch(/AUTONOMOUS_NOT_PRIMARY|OTHER_CHARACTER/);
    f.primary(); expect(await f.ingestion.maybeRun({ characterId: "taki" })).toBeNull();
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(f.timeline.latestSeq("taki")))).toMatchObject({ status: "success", writes: 0 });
    expect(model.doGenerateCalls).toHaveLength(2); expect(f.journal.unprocessedCount(f.scope)).toBe(0);
  });

  it("reopens both-Bank partial Pending with the same gate, original payloads and operation identities", async () => {
    const path = tempPath(); const model = script(keep("both")); const first = fixture(model, path);
    first.ingestion.initializeBaseline("taki"); first.primary(); first.failedBanks.add("native-taki");
    await expect(first.ingestion.run({ characterId: "taki" })).rejects.toThrow("MEMORY_INGESTION_FAILED");
    const saved = first.journal.pending(first.scope)!; expect(saved.receipts).toHaveLength(1); expect(saved.batches).toHaveLength(2);
    expect(first.journal.cursor(first.scope)).toBe(0); first.close();
    const second = fixture(model, path);
    expect(await second.ingestion.maybeRun({ characterId: "taki" })).toMatchObject({ writes: 1, pendingSources: 1, throughSeq: 2 });
    expect(second.retain).toHaveBeenCalledTimes(1); expect(second.retain.mock.calls[0]?.[0].requestId).toBe(saved.batches[1]?.requestId);
    expect(second.retain.mock.calls[0]?.[1]).toEqual(saved.batches[1]?.request);
    expect(second.pending.list({ authorityEpochId: EPOCH, bankId: "native-global" })).toHaveLength(1);
    expect(second.pending.list({ authorityEpochId: EPOCH, bankId: "native-taki" })).toHaveLength(1);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(await second.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "success", writes: 0 });
  });

  it("attempts the independent Character Bank even when Global queue admission fails", async () => {
    const model = script(keep("both")); const f = fixture(model); f.ingestion.initializeBaseline("taki"); f.primary();
    f.failedBanks.add("native-global");
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "retryable_failure" });
    expect(f.journal.pending(f.scope)?.receipts.map((receipt) => receipt.bankId)).toEqual(["native-taki"]);
    f.failedBanks.clear(); expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 1, pendingSources: 1 });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("refuses an invented Pending promise and retries the original plan below cadence once real admission works", async () => {
    const model = script(keep()); const f = fixture(model); f.ingestion.initializeBaseline("taki"); f.primary(); f.mode("promise");
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "retryable_failure" });
    const saved = f.journal.pending(f.scope)!; expect(saved.receipts).toEqual([]); expect(f.journal.cursor(f.scope)).toBe(0);
    expect(f.pending.list({ authorityEpochId: EPOCH, bankId: "native-taki" })).toEqual([]);
    f.mode("queue"); expect(await f.ingestion.maybeRun({ characterId: "taki" })).toMatchObject({ writes: 1, pendingSources: 1 });
    expect(f.retain.mock.calls.map(([context]) => context.requestId)).toEqual([saved.batches[0]?.requestId, saved.batches[0]?.requestId]);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("proves queue durability after a lost ACK without claiming native completion", async () => {
    const f = fixture(script(keep())); f.ingestion.initializeBaseline("taki"); f.primary(); f.mode("lost-ack");
    expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 1, pendingSources: 1, confirmedSources: 0 });
    expect(f.pending.summary({ authorityEpochId: EPOCH, bankId: "native-taki" })).toMatchObject({ pendingCount: 1, nativeConfirmedCount: 0 });
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "success", writes: 0 });
    expect(f.retain).toHaveBeenCalledTimes(1);
  });

  it("recovers an outbox commit whose ingestion acknowledgement transaction rolled back", async () => {
    const path = tempPath(); const model = script(keep()); const first = fixture(model, path);
    first.ingestion.initializeBaseline("taki"); first.primary();
    first.db.exec(`CREATE TRIGGER fail_ingestion_ack BEFORE UPDATE ON hindsight_ingestion_spans
      WHEN NEW.receipts_json<>'[]' BEGIN SELECT RAISE(ABORT,'controlled acknowledgement failure'); END`);
    await expect(first.ingestion.run({ characterId: "taki" })).rejects.toThrow();
    const pending = first.journal.pending(first.scope)!; expect(pending.receipts).toEqual([]);
    expect(first.pending.list({ authorityEpochId: EPOCH, bankId: "native-taki" })).toHaveLength(1); first.close();
    const second = fixture(model, path); second.db.exec("DROP TRIGGER fail_ingestion_ack");
    expect(await second.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 1, pendingSources: 1 });
    expect(second.retain).toHaveBeenCalledTimes(0); expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("accepts a validated completed provider receipt without inventing extracted memories", async () => {
    const model = script(keep()); const f = fixture(model); f.ingestion.initializeBaseline("taki"); f.primary(); f.mode("completed");
    expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 1, confirmedSources: 1, pendingSources: 0 });
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "success", writes: 0 });
    expect(model.doGenerateCalls).toHaveLength(1); expect(f.retain).toHaveBeenCalledTimes(1);
  });

  it.each(["document", "request", "epoch", "provider"])("refuses a completed receipt with mismatched %s", async (field) => {
    const f = fixture(script(keep())); f.ingestion.initializeBaseline("taki"); f.primary(); f.mode("completed");
    f.transform((result) => result.ok ? { ...result,
      ...(field === "request" ? { requestId: "another-request" } : {}),
      ...(field === "epoch" ? { authorityEpochId: "another-epoch" } : {}),
      ...(field === "provider" ? { providerId: "local", capabilities: { ...caps, providerId: "local" } } : {}),
      data: field === "document" ? { ...result.data, documentId: "another-source" } : result.data } : result);
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "retryable_failure" });
    expect(f.journal.cursor(f.scope)).toBe(0); expect(f.journal.pending(f.scope)?.receipts).toEqual([]);
  });

  it("does not reuse a durable queue receipt after that exact Pending source was cancelled", async () => {
    const f = fixture(script(keep())); f.ingestion.initializeBaseline("taki"); f.primary(); await f.ingestion.run({ characterId: "taki" });
    const row = f.pending.list({ authorityEpochId: EPOCH, bankId: "native-taki" })[0]!;
    f.pending.cancelQueued(pendingMemoryRef(row));
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "retryable_failure" });
    expect(f.retain).toHaveBeenCalledTimes(1);
  });

  it.each(["before-baseline", "before-covered-cursor"] as const)("processes a late exact commit %s without repeating a completed gate", async (scenario) => {
    const decisions = scenario === "before-covered-cursor" ? [keep("character", 3, 4), keep("character", 1, 2)] : [keep()];
    const model = script(...decisions); const f = fixture(model);
    const earlier = [f.timeline.append({ characterId: "taki", role: "user", content: "Earlier original source." }),
      f.timeline.append({ characterId: "taki", role: "assistant", content: "Earlier original answer." })];
    f.ingestion.initializeBaseline("taki"); expect(f.journal.eligibilityStartSeq(f.scope)).toBe(3);
    if (scenario === "before-covered-cursor") { f.primary(); await f.ingestion.run({ characterId: "taki" }); }
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: earlier, runId: "late-primary" });
    expect(f.journal.unprocessedCount(f.scope)).toBe(2);
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "success", writes: 1 });
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: earlier, runId: "late-primary" });
    expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 0 });
    expect(model.doGenerateCalls).toHaveLength(decisions.length);
    expect(f.pending.list({ authorityEpochId: EPOCH, bankId: "native-taki" }).some((row) => row.intent.operation.kind === "retain"
      && row.intent.operation.request.content === earlier.map((entry) => entry.content).join("\n"))).toBe(true);
  });

  it("separates pre-baseline history from an unresolved post-baseline user witness", async () => {
    const model = script(keep("global", 3, 3)); const f = fixture(model);
    f.timeline.append({ characterId: "taki", role: "user", content: "Unknown old user source." });
    f.timeline.append({ characterId: "taki", role: "assistant", content: "Unknown old assistant source." });
    f.ingestion.initializeBaseline("taki");
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toEqual({ status: "not_required", reason: "before_canonical_ingestion_eligibility" });
    const current = f.timeline.append({ characterId: "taki", role: "user", content: "Exact new source." });
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(3))).toMatchObject({ status: "retryable_failure" });
    expect(model.doGenerateCalls).toHaveLength(0);
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: [current] });
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(3))).toMatchObject({ status: "success", writes: 1 });
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("Unknown old");
  });

  it("rolls back the entire primary witness batch and rejects changed complete-commit boundaries", () => {
    const f = fixture(script(keep())); f.ingestion.initializeBaseline("taki");
    const entries = [f.timeline.append({ characterId: "taki", role: "user", content: "User source." }),
      f.timeline.append({ characterId: "taki", role: "assistant", content: "Assistant source." })];
    expect(() => f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: [entries[0]!, { ...entries[1]!, content: "FORGED" }] }))
      .toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    expect(f.journal.unprocessedCount(f.scope)).toBe(0);
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries });
    expect(() => f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: [entries[0]!] })).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    expect(() => f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries, runId: "different-run" })).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    expect(f.journal.unprocessedCount(f.scope)).toBe(2);
  });

  it("rolls back an interrupted multi-witness claim before any gate or dispatch", async () => {
    const model = script(keep()); const f = fixture(model); f.ingestion.initializeBaseline("taki"); f.primary();
    f.db.exec(`CREATE TRIGGER fail_source_claim BEFORE UPDATE ON hindsight_ingestion_primary_commits
      WHEN NEW.timeline_seq=2 BEGIN SELECT RAISE(ABORT,'controlled claim failure'); END`);
    await expect(f.ingestion.run({ characterId: "taki" })).rejects.toThrow();
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM hindsight_ingestion_spans").get()?.n).toBe(0);
    expect(f.journal.unprocessedCount(f.scope)).toBe(2); expect(model.doGenerateCalls).toHaveLength(0); expect(f.retain).not.toHaveBeenCalled();
    f.db.exec("DROP TRIGGER fail_source_claim"); expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 1 });
  });

  it("blocks a source changed while retain is in flight even when the old original reached the outbox", async () => {
    const f = fixture(script(keep())); f.ingestion.initializeBaseline("taki"); const entries = f.primary();
    const original = f.retain.getMockImplementation()!;
    f.retain.mockImplementation(async (context, request) => {
      const result = await original(context, request);
      f.db.prepare("UPDATE timeline_messages SET content='changed after witness' WHERE seq=:seq").run({ seq: entries[0]!.seq });
      return result;
    });
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "retryable_failure" });
    expect(f.journal.cursor(f.scope)).toBe(0); expect(f.pending.list({ authorityEpochId: EPOCH, bankId: "native-taki" })).toHaveLength(1);
  });

  it("blocks a late acknowledgement after Hindsight authority changes", async () => {
    const f = fixture(script(keep())); f.ingestion.initializeBaseline("taki"); f.primary();
    const original = f.retain.getMockImplementation()!;
    f.retain.mockImplementation(async (context, request) => {
      const result = await original(context, request);
      f.db.exec("UPDATE canonical_memory_authority_epochs SET provider_id='local' WHERE epoch_id='hindsight-epoch'"); return result;
    });
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toEqual({ status: "retryable_failure", code: "MEMORY_AUTHORITY_FENCED" });
    expect(f.db.prepare("SELECT through_seq FROM hindsight_ingestion_cursors").get()?.through_seq).toBe(0);
  });

  it("fails closed when a frozen Bank generation changes before retry", async () => {
    const model = script(keep()); const f = fixture(model); f.ingestion.initializeBaseline("taki"); f.primary(); f.mode("promise");
    await expect(f.ingestion.run({ characterId: "taki" })).rejects.toThrow("MEMORY_INGESTION_RECEIPT_UNPROVEN");
    f.db.prepare("UPDATE hindsight_replica_sync_checkpoints SET bank_generation=:generation WHERE bank_id='native-taki'").run({ generation: LINEAGE });
    f.mode("queue");
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toEqual({ status: "retryable_failure", code: "MEMORY_AUTHORITY_FENCED" });
    expect(f.retain).toHaveBeenCalledTimes(1); expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("rejects a changed persisted request instead of sending it under an earlier operation identity", async () => {
    const f = fixture(script(keep())); f.ingestion.initializeBaseline("taki"); f.primary(); f.mode("promise");
    await expect(f.ingestion.run({ characterId: "taki" })).rejects.toThrow();
    f.db.exec("UPDATE hindsight_ingestion_spans SET batches_json=json_set(batches_json,'$[0].request.content','tampered source')");
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "retryable_failure" });
    expect(f.retain).toHaveBeenCalledTimes(1);
  });

  it("rechecks queued coverage through an injected verified app Bank reader after old B5 Bank rows are cleared", async () => {
    const verified = (bankId: string) => { const bank = BANKS.find((item) => item.bankId === bankId); return bank ? bankRecord(bank) : undefined; };
    const f = fixture(script(keep()), ":memory:", verified); f.ingestion.initializeBaseline("taki"); f.primary();
    await f.ingestion.run({ characterId: "taki" });
    f.db.exec("DELETE FROM hindsight_replica_sync_records WHERE object_kind='bank'");
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "success", writes: 0 });
    expect(f.retain).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to old B5 Bank rows when the injected app reader refuses a binding", async () => {
    const f = fixture(script(keep()), ":memory:", () => undefined); f.ingestion.initializeBaseline("taki"); f.primary();
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toEqual({ status: "retryable_failure", code: "MEMORY_AUTHORITY_FENCED" });
    expect(f.retain).not.toHaveBeenCalled();
  });

  it("keeps the completed gate when verified Bank routing is temporarily unavailable", async () => {
    let available = false;
    const model = script(keep()); const f = fixture(model, ":memory:", (bankId) => available
      ? bankRecord(BANKS.find((bank) => bank.bankId === bankId)!) : undefined);
    f.ingestion.initializeBaseline("taki"); f.primary();
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "retryable_failure" });
    expect(f.journal.pending(f.scope)).toMatchObject({ gate: keep(), batches: [], receipts: [] });
    expect(model.doGenerateCalls).toHaveLength(1); available = true;
    expect(await f.ingestion.maybeRun({ characterId: "taki" })).toMatchObject({ writes: 1, pendingSources: 1 });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("keeps failed gate source durable and private without advancing coverage", async () => {
    const f = fixture(failingGenerateModel(new Error("PRIVATE_MODEL_FAILURE api_key=PRIVATE_SECRET")));
    f.ingestion.initializeBaseline("taki"); f.primary();
    await expect(f.ingestion.run({ characterId: "taki" })).rejects.toThrow("MEMORY_INGESTION_GATE_FAILED");
    expect(f.journal.cursor(f.scope)).toBe(0); expect(f.journal.pending(f.scope)?.gate).toBeNull();
    expect(f.retain).not.toHaveBeenCalled(); expect(JSON.stringify(f.logs)).not.toContain("PRIVATE_");
  });

  it("retains maximum-size supported original wording without spending its budget on transcript framing", async () => {
    const f = fixture(script(keep("global", 1, 1))); f.ingestion.initializeBaseline("taki");
    const content = "界".repeat(100_000); const entry = f.timeline.append({ characterId: "taki", role: "user", content });
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: [entry] });
    expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 1, pendingSources: 1 });
    const row = f.pending.list({ authorityEpochId: EPOCH, bankId: "native-global" })[0]!;
    expect(row.intent.operation.kind === "retain" && row.intent.operation.request.content).toBe(content);
  });

  it("serializes simultaneous run/flush and persists skipped source coverage across reopen", async () => {
    const path = tempPath(); const model = script({ decision: "skip" }); const first = fixture(model, path);
    first.ingestion.initializeBaseline("taki"); first.primary();
    const results = await Promise.all([first.ingestion.run({ characterId: "taki" }), first.ingestion.flushPort.prepareRetirement(retirement(2))]);
    expect(results[0]).toMatchObject({ writes: 0, skippedSpans: 1 }); expect(results[1]).toMatchObject({ status: "success", writes: 0 });
    expect(model.doGenerateCalls).toHaveLength(1); first.close();
    const second = fixture(model, path);
    expect(await second.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "success", writes: 0 });
    expect(second.retain).not.toHaveBeenCalled(); expect(model.doGenerateCalls).toHaveLength(1);
  });
});

function deferred() {
  let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve };
}
function tick() { return new Promise<void>((resolve) => setImmediate(resolve)); }

describe("Hindsight ingestion owned shutdown and drain", () => {
  it("waits for an abort-ignoring gate, refuses queued work and leaves an unfinished source retryable after reopen", async () => {
    const file = tempPath(); const model = script(keep()); const entered = deferred(); const release = deferred();
    const generate = model.doGenerate;
    vi.spyOn(model, "doGenerate").mockImplementation(async (input) => { const result = await generate(input); entered.resolve(); await release.promise; return result; });
    const f = fixture(model, file); cleanup.push(release.resolve); f.ingestion.initializeBaseline("taki"); const entries = f.primary();
    const saveGate = vi.spyOn(f.journal, "saveGate"); const acknowledge = vi.spyOn(f.journal, "acknowledgeBank");
    const outcomes = Promise.allSettled([f.ingestion.run({ characterId: "taki" }), f.ingestion.run({ characterId: "taki" })]);
    await entered.promise; let stopped = false; const stopping = f.ingestion.stop().then(() => { stopped = true; });
    await tick(); expect(stopped).toBe(false); expect(saveGate).not.toHaveBeenCalled(); expect(f.retain).not.toHaveBeenCalled();
    release.resolve(); await stopping;
    expect(await outcomes).toMatchObject([
      { status: "rejected", reason: { message: "MEMORY_OPERATION_CANCELLED" } },
      { status: "rejected", reason: { message: "MEMORY_OPERATION_CANCELLED" } },
    ]);
    expect(saveGate).not.toHaveBeenCalled(); expect(acknowledge).not.toHaveBeenCalled();
    const span = f.journal.pending(f.scope)!; expect(span).toMatchObject({ gate: null, batches: [], receipts: [], state: "pending" });
    expect(f.journal.cursor(f.scope)).toBe(0); f.close(); const prepare = vi.spyOn(f.db, "prepare");
    await expect(f.ingestion.run({ characterId: "taki" })).rejects.toThrow("MEMORY_OPERATION_CANCELLED");
    await expect(f.ingestion.maybeRun({ characterId: "taki" })).rejects.toThrow("MEMORY_OPERATION_CANCELLED");
    expect(() => f.ingestion.initializeBaseline("taki")).toThrow("MEMORY_OPERATION_CANCELLED");
    expect(() => f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries })).toThrow("MEMORY_OPERATION_CANCELLED");
    expect(await f.ingestion.flushPort.prepareRetirement(retirement(2))).toMatchObject({ status: "retryable_failure" });
    expect(prepare).not.toHaveBeenCalled(); expect(model.doGenerateCalls).toHaveLength(1);
    const retryModel = script(keep()); const reopened = fixture(retryModel, file);
    expect(reopened.journal.pending(reopened.scope)?.spanId).toBe(span.spanId);
    expect(await reopened.ingestion.maybeRun({ characterId: "taki" })).toMatchObject({ writes: 1, pendingSources: 1, throughSeq: 2 });
    expect(retryModel.doGenerateCalls).toHaveLength(1); expect(reopened.retain).toHaveBeenCalledTimes(1);
  });

  it("refuses a gate queued behind another Utility owner and leaves the shared slot usable", async () => {
    const model = script(keep()); const f = fixture(model); const entered = deferred(); const release = deferred(); cleanup.push(release.resolve);
    const held = f.slot.run("fixture-other-owner", async () => { entered.resolve(); await release.promise; return { held: true }; });
    await entered.promise; f.ingestion.initializeBaseline("taki"); f.primary();
    const running = f.ingestion.run({ characterId: "taki" }); const result = Promise.allSettled([running]); await tick();
    expect(f.journal.pending(f.scope)?.gate).toBeNull(); let stopped = false;
    const stopping = f.ingestion.stop().then(() => { stopped = true; }); await tick(); expect(stopped).toBe(false);
    release.resolve(); await held; await stopping;
    expect(await result).toMatchObject([{ status: "rejected", reason: { message: "MEMORY_OPERATION_CANCELLED" } }]);
    expect(model.doGenerateCalls).toHaveLength(0); expect(f.retain).not.toHaveBeenCalled();
    expect(await f.slot.run("fixture-still-active-owner", async () => "owner-result")).toBe("owner-result");
  });

  it.each(["resolve", "reject"] as const)("waits for a late retain %s, propagates cancellation and recovers the exact durable outbox after reopen", async (ending) => {
    const file = tempPath(); const model = script(keep("both")); const f = fixture(model, file);
    const entered = deferred(); const release = deferred(); cleanup.push(release.resolve);
    const retain = f.retain.getMockImplementation()!;
    f.retain.mockImplementation(async (context, request) => {
      const result = await retain(context, request); entered.resolve(); await release.promise;
      if (ending === "reject") throw new Error("PRIVATE_LATE_RETAIN_FAILURE"); return result;
    });
    f.ingestion.initializeBaseline("taki"); f.primary(); const acknowledge = vi.spyOn(f.journal, "acknowledgeBank");
    const running = f.ingestion.run({ characterId: "taki" }); const result = Promise.allSettled([running]); await entered.promise;
    const request = f.retain.mock.calls[0]!; expect(request[0].signal?.aborted).toBe(false);
    let stopped = false; const stopping = f.ingestion.stop().then(() => { stopped = true; });
    expect(request[0].signal?.aborted).toBe(true); await tick(); expect(stopped).toBe(false);
    const coverage = vi.spyOn(f.journal, "pendingCoverage"); release.resolve(); await stopping;
    expect(await result).toMatchObject([{ status: "rejected", reason: { message: "MEMORY_OPERATION_CANCELLED" } }]);
    expect(coverage).not.toHaveBeenCalled(); expect(acknowledge).not.toHaveBeenCalled(); expect(f.retain).toHaveBeenCalledTimes(1);
    expect(f.journal.pending(f.scope)).toMatchObject({ gate: keep("both"), receipts: [], state: "pending" });
    const original = f.pending.list({ authorityEpochId: EPOCH, bankId: "native-global" })[0]!;
    expect(original.intent.operationId).toBe(request[0].requestId); expect(f.journal.cursor(f.scope)).toBe(0); f.close();
    const retryModel = failingGenerateModel(new Error("saved gate must not run again")); const reopened = fixture(retryModel, file);
    expect(await reopened.ingestion.maybeRun({ characterId: "taki" })).toMatchObject({ writes: 2, pendingSources: 2, throughSeq: 2 });
    expect(retryModel.doGenerateCalls).toHaveLength(0); expect(reopened.retain).toHaveBeenCalledTimes(1);
    expect(reopened.retain.mock.calls[0]?.[1].bankId).toBe("native-taki");
    expect(reopened.pending.list({ authorityEpochId: EPOCH, bankId: "native-global" })[0]).toEqual(original);
  });

  it("settles ordinary ingestion without cancelling the gate or sealing future calls", async () => {
    const model = script(keep()); const entered = deferred(); const release = deferred(); const generate = model.doGenerate;
    vi.spyOn(model, "doGenerate").mockImplementation(async (input) => { const result = await generate(input); entered.resolve(); await release.promise; return result; });
    const f = fixture(model); cleanup.push(release.resolve); f.ingestion.initializeBaseline("taki"); f.primary();
    const running = f.ingestion.run({ characterId: "taki" }); await entered.promise; let settled = false;
    const draining = f.ingestion.settle().then(() => { settled = true; }); await tick(); expect(settled).toBe(false);
    release.resolve(); await draining; expect(await running).toMatchObject({ writes: 1, pendingSources: 1 });
    expect(await f.ingestion.run({ characterId: "taki" })).toMatchObject({ writes: 0, throughSeq: 2 });
    expect(model.doGenerateCalls).toHaveLength(1); expect(f.retain.mock.calls[0]?.[0].signal?.aborted).toBe(false);
  });
});
