import { afterEach, describe, expect, it } from "vitest";
import { createCanonicalIngestionRepo } from "./canonical-ingestion-repo.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "./canonical-memory-maintenance-repo.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { createCanonicalMemorySparseRepo } from "./canonical-memory-sparse-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase } from "./sqlite.ts";
import { createTimelineRepo } from "./timeline-repo.ts";
import { sanitizeCommittedPrimarySpan } from "../memory/canonical-ingestion-source.ts";
import { createLocalMemoryProvider } from "../memory/local-memory-provider.ts";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";

const AT = "2026-09-11T00:00:00.000Z";
const close: Array<() => void> = [];
afterEach(() => { for (const dispose of close.splice(0)) dispose(); });
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  close.push(() => db.close());
  const authority = createCanonicalMemoryAuthorityRepo(db);
  const epoch = authority.initializeLocalAuthority(AT);
  authority.createBank({ authorityEpochId: epoch.epochId, bankId: "character", scope: { kind: "character", characterId: "taki" },
    name: "Taki", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "test", config: {} });
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: true });
  const maintenance = createCanonicalMemoryMaintenanceRepo(db, tokenizer);
  const journal = createCanonicalIngestionRepo({ db, maintenance });
  const timeline = createTimelineRepo(db);
  const provider = createLocalMemoryProvider({ authority, maintenance, tokenizer, records: createCanonicalMemoryRepo(db),
    sparse: createCanonicalMemorySparseRepo(db), now: () => AT });
  const scope = { epochId: epoch.epochId, characterId: "taki" };
  journal.initializeBaseline({ ...scope, throughSeq: 0, now: AT });
  const entries = [timeline.append({ characterId: "taki", role: "user", content: "I prefer plain noodles" }),
    timeline.append({ characterId: "taki", role: "assistant", content: "I will remember your preference" })];
  return { db, scope, journal, entries, timeline, maintenance, provider };
}

describe("canonical ingestion journal and primary witnesses", () => {
  it("records only exact durable rows and rolls back the whole witness batch on a forged later row", () => {
    const f = fixture();
    expect(() => f.journal.recordPrimaryCommitted({ characterId: "taki",
      entries: [f.entries[0]!, { ...f.entries[1]!, content: "forged content" }] })).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    expect(f.db.prepare("SELECT * FROM canonical_memory_primary_commits").all()).toEqual([]);
    f.journal.recordPrimaryCommitted({ characterId: "taki", entries: f.entries, runId: "test-run" });
    f.journal.recordPrimaryCommitted({ characterId: "taki", entries: f.entries, runId: "test-run" });
    expect(f.journal.primaryEntries({ characterId: "taki", fromSeq: 0, throughSeq: 2 })).toHaveLength(2);
    expect(f.db.prepare("SELECT * FROM canonical_memory_primary_commits").all()).toHaveLength(2);
    expect(f.journal.cursor(f.scope)).toBe(0);
  });

  it("detects an edited row behind an old witness and never treats a role-only row as proof", () => {
    const f = fixture();
    expect(() => f.journal.primaryEntries({ characterId: "taki", fromSeq: 0, throughSeq: 2 })).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    f.journal.recordPrimaryCommitted({ characterId: "taki", entries: f.entries });
    f.db.prepare("UPDATE timeline_messages SET content=:text WHERE seq=1").run({ text: "edited after witnessing" });
    expect(() => f.journal.primaryEntries({ characterId: "taki", fromSeq: 0, throughSeq: 2 })).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    expect(f.journal.cursor(f.scope)).toBe(0);
  });

  it("keeps primary completion boundaries immutable and assigns exact witnesses to one ingestion span", () => {
    const f = fixture();
    f.journal.recordPrimaryCommitted({ characterId: "taki", entries: f.entries, runId: "completed-primary" });
    const before = f.db.prepare("SELECT * FROM canonical_memory_primary_commits ORDER BY timeline_seq").all();
    const later = f.timeline.append({ characterId: "taki", role: "assistant", content: "Later independent delivery" });
    for (const commit of [
      { entries: f.entries, runId: "different-run" },
      { entries: f.entries.slice(0, 1), runId: "completed-primary" },
      { entries: [...f.entries, later], runId: "completed-primary" },
    ]) expect(() => f.journal.recordPrimaryCommitted({ characterId: "taki", ...commit })).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    expect(f.db.prepare("SELECT * FROM canonical_memory_primary_commits ORDER BY timeline_seq").all()).toEqual(before);
    const entries = f.journal.pendingEntries({ ...f.scope, throughSeq: 3 });
    expect(entries.map((entry) => entry.committedThroughSeq)).toEqual([2, 2]);
    expect(f.journal.unprocessedCount(f.scope)).toBe(2);
    const source = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: 2, entries });
    let state = f.journal.start({ ...f.scope, source, now: AT });
    expect(f.db.prepare("SELECT authority_epoch_id,ingestion_span_id FROM canonical_memory_primary_commits").all())
      .toEqual(Array.from({ length: 2 }, () => ({ authority_epoch_id: f.scope.epochId, ingestion_span_id: state.spanId })));
    expect(f.journal.unprocessedCount(f.scope)).toBe(0);
    expect(f.journal.pendingEntries({ ...f.scope, throughSeq: 3 })).toEqual([]);
    expect(() => f.journal.advanceCoverage({ ...f.scope, throughSeq: 3, now: AT })).toThrow("MEMORY_INGESTION_INCOMPLETE");
    state = f.journal.saveGate({ state, gate: { decision: "skip" }, now: AT });
    f.journal.complete({ state, now: AT });
    expect(f.journal.pending(f.scope)).toBeUndefined();
    f.journal.recordPrimaryCommitted({ characterId: "taki", entries: f.entries, runId: "completed-primary" });
    expect(f.journal.unprocessedCount(f.scope)).toBe(0);
    expect(f.journal.latestPrimarySeq("taki")).toBe(2);
  });

  it("cannot acknowledge a fabricated Bank success or replace the approved source with another payload", () => {
    const f = fixture();
    f.journal.recordPrimaryCommitted({ characterId: "taki", entries: f.entries });
    const source = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: 2,
      entries: f.journal.primaryEntries({ characterId: "taki", fromSeq: 0, throughSeq: 2 }) });
    let state = f.journal.start({ ...f.scope, source, now: AT });
    state = f.journal.saveGate({ state, gate: { decision: "keep", route: "character", fromSeq: 1, throughSeq: 2 }, now: AT });
    const facts = [{ layer: "episodes", content: "I remember their preference for plain noodles.", importance: 5, disclosure: null }];
    state = f.journal.saveExtraction({ state, extraction: { facts, batches: [] }, now: AT });
    const batch = f.provider.prepareIngestion({ ...f.scope, bankId: "character", spanId: state.spanId, source,
      gate: { decision: "keep", route: "character", fromSeq: 1, throughSeq: 2 }, facts });
    expect(() => f.journal.saveExtraction({ state,
      extraction: { facts, batches: [{ ...batch, source: { ...batch.source, retainedText: "different source" } }] }, now: AT,
    })).toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    state = f.journal.saveExtraction({ state, extraction: { facts, batches: [batch] }, now: AT });
    expect(() => f.journal.acknowledgeBank({ state, bankId: "character", now: AT })).toThrow("MEMORY_INGESTION_RECEIPT_UNPROVEN");
    expect(() => f.journal.complete({ state, now: AT })).toThrow("MEMORY_INGESTION_INCOMPLETE");
    expect(f.journal.cursor(f.scope)).toBe(0);
  });

  it("fails closed on corrupted source state or changed authority instead of moving the cursor", () => {
    const f = fixture();
    f.journal.recordPrimaryCommitted({ characterId: "taki", entries: f.entries });
    const source = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: 2,
      entries: f.journal.primaryEntries({ characterId: "taki", fromSeq: 0, throughSeq: 2 }) });
    f.journal.start({ ...f.scope, source, now: AT });
    f.db.prepare("UPDATE canonical_memory_ingestion_spans SET source_json=:source")
      .run({ source: JSON.stringify({ ...source, excludedRows: source.excludedRows + 1 }) });
    expect(() => f.journal.pending(f.scope)).toThrow("MEMORY_INGESTION_STATE_INVALID");
    expect(f.journal.cursor(f.scope)).toBe(0);
    f.db.exec("UPDATE canonical_memory_authority_epochs SET provider_id='foreign-provider'");
    expect(() => f.journal.pending(f.scope)).toThrow("MEMORY_AUTHORITY_MISMATCH");
    expect(f.db.prepare("SELECT through_seq FROM canonical_memory_ingestion_cursors").get()?.through_seq).toBe(0);
  });

  it("refuses a failed witness transaction without creating partial eligibility or completion evidence", () => {
    const f = fixture();
    f.db.exec(`CREATE TRIGGER refuse_second_witness BEFORE INSERT ON canonical_memory_primary_commits
      WHEN NEW.timeline_seq=2 BEGIN SELECT RAISE(ABORT,'controlled witness failure'); END`);
    expect(() => f.journal.recordPrimaryCommitted({ characterId: "taki", entries: f.entries })).toThrow("controlled witness failure");
    expect(f.db.prepare("SELECT * FROM canonical_memory_primary_commits").all()).toEqual([]);
    expect(f.journal.cursor(f.scope)).toBe(0);
    expect(f.journal.eligibilityStartSeq(f.scope)).toBe(1);
    expect(f.journal.pending(f.scope)).toBeUndefined();
  });
});
