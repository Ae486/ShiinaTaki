import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { SourceContextSchema, type TimelineEntry } from "@taki/shared";
import { openDatabase, type Database } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { createTimelineRepo } from "./timeline-repo.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createCanonicalIngestionSourceRepo } from "./canonical-ingestion-source-repo.ts";
import { createHindsightIngestionSourceRepo } from "./hindsight-ingestion-source-repo.ts";
import { primarySourceRowDigest } from "./primary-source-row.ts";
import { readPrimaryMemorySource } from "./primary-memory-source-read.ts";
import { createPrimaryConversationSourceRepo } from "./primary-conversation-source-repo.ts";
import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";
import { LOCAL_MEMORY_CAPABILITIES } from "../memory/local-memory-provider.ts";
import { createPrimaryMemorySourceState } from "../memory/primary-memory-source-state.ts";
import { primaryEntryDigest, sanitizeCommittedPrimarySpan, retainedIngestionSource, ingestionSourceDigest } from "../memory/canonical-ingestion-source.ts";
import { createCanonicalIngestionModel } from "../memory/canonical-ingestion-model.ts";
import { createUtilitySlot } from "../memory/utility-slot.ts";
import { scriptedGenerateModel } from "../testing/mock-language-model.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { HindsightIngestionStateSchema, prepareHindsightIngestionBatch } from "../memory/hindsight/hindsight-ingestion-contract.ts";

const AT = "2026-10-22T00:00:00.000Z";
const LINEAGE = "11111111-1111-4111-8111-111111111111";
const sourceContext = SourceContextSchema.parse({ materials: [{ label: "Interview", speaker: "Narrator", reference: "fixture:interview" }] });
const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture(native = false) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  let epochId: string;
  if (native) {
    epochId = "native-epoch";
    db.prepare(`INSERT INTO canonical_memory_authority_epochs
      (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES (:epoch,'hindsight',:lineage,'active',NULL,:at,NULL,'planned-switch')`).run({ epoch: epochId, lineage: LINEAGE, at: AT });
    db.prepare("INSERT INTO canonical_memory_authority_state(singleton,active_epoch_id,updated_at) VALUES(1,:epoch,:at)")
      .run({ epoch: epochId, at: AT });
  } else epochId = createCanonicalMemoryAuthorityRepo(db).initializeLocalAuthority(AT).epochId;
  const repo = native ? createHindsightIngestionSourceRepo(db) : createCanonicalIngestionSourceRepo(db);
  const scope = { epochId, characterId: "taki", now: AT };
  repo.initializeBaseline({ ...scope, throughSeq: 0 });
  const timeline = createTimelineRepo(db);
  return { db, repo, scope, timeline };
}

describe("conditional source evidence at every original-primary reader", () => {
  it("keeps captured source authority currentness before asynchronous provider binding", () => {
    const f = fixture(); const sources = createPrimaryConversationSourceRepo({ db: f.db, timeline: f.timeline });
    f.db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
      verified_snapshot_id='fixture',activation_transaction_id='fixture'`).run({ epoch: f.scope.epochId });
    const memory = createMemoryRunReference({ providerId: "local", authorityEpochId: f.scope.epochId,
      providerLineageId: "captured-lineage", contractVersion: 1, capabilities: LOCAL_MEMORY_CAPABILITIES });
    const opened = sources.begin({ user: { characterId: "taki", role: "user", content: "Keep this constraint." }, runId: "run", memory });
    const row = f.db.prepare("SELECT id,seq,character_id,role,content,parts,created_at,source_context_json FROM timeline_messages WHERE id=:id")
      .get({ id: opened.userEntry.id })!;
    const witness = { characterId: "taki", userTimelineId: opened.userEntry.id,
      userTimelineSeq: opened.userEntry.seq, sourceDigest: primarySourceRowDigest(row) };
    const state = createPrimaryMemorySourceState({ db: f.db, assertAlive: () => undefined, hindsight: () => undefined });
    expect(readPrimaryMemorySource(f.db, witness)).toEqual({ kind: "unbound", epochId: f.scope.epochId });
    expect(state(witness)).toBe("current");
    f.db.exec("UPDATE memory_authority_selection SET active_epoch_id='different-epoch'");
    expect(state(witness)).toBe("unavailable");
    sources.retract(opened.sourceId);
    expect(state(witness)).toBe("withdrawn");
    expect(f.db.prepare("SELECT * FROM canonical_memory_primary_commits").all()).toEqual([]);
  });

  it("preserves old entry/C3 digest bytes for absent and SQL-null context", () => {
    const f = fixture(); const entry = f.timeline.append({ characterId: "taki", role: "user", content: "I prefer noodles" });
    const old = { id: entry.id, seq: entry.seq, characterId: entry.characterId, role: entry.role,
      content: entry.content, parts: null, createdAt: entry.createdAt };
    expect(primaryEntryDigest(entry)).toBe(hash(JSON.stringify(old)));
    const row = f.db.prepare("SELECT id,seq,character_id,role,content,parts,created_at FROM timeline_messages").get()!;
    expect(primarySourceRowDigest(row)).toBe(hash(JSON.stringify(row)));
    expect(primarySourceRowDigest({ ...row, source_context_json: null })).toBe(hash(JSON.stringify(row)));
  });

  it.each([false, true])("retains exact source witnesses with native=%s and excludes uncommitted publication", (native) => {
    const f = fixture(native);
    const entry = f.timeline.append({ characterId: "taki", role: "user", content: "视频里他说‘我失业了’。我的项目停了。", sourceContext });
    const speech = f.timeline.append({ characterId: "taki", role: "assistant", content: "Publication without primary acceptance", sourceContext });
    expect(() => f.repo.recordPrimaryCommitted({ ...f.scope, entries: [{ ...entry, sourceContext: { materials: [{ speaker: "user" }] } }] }))
      .toThrow("MEMORY_INGESTION_SOURCE_UNPROVEN");
    f.repo.recordPrimaryCommitted({ ...f.scope, entries: [entry] });
    const proofs = f.repo.pendingEntries({ ...f.scope, throughSeq: speech.seq });
    expect(proofs).toHaveLength(1); expect(proofs[0]?.entry.sourceContext).toEqual(sourceContext);
    const row = f.db.prepare("SELECT id,seq,character_id,role,content,parts,created_at,source_context_json FROM timeline_messages WHERE seq=:seq")
      .get({ seq: entry.seq })!;
    const witness = { characterId: "taki", userTimelineId: entry.id, userTimelineSeq: entry.seq, sourceDigest: primarySourceRowDigest(row) };
    expect(readPrimaryMemorySource(f.db, witness)).toEqual({ kind: "unbound", epochId: f.scope.epochId });
    expect(readPrimaryMemorySource(f.db, { ...witness, sourceDigest: primarySourceRowDigest({ ...row, source_context_json: null }) })).toEqual({ kind: "withdrawn" });
    expect(() => f.db.prepare("UPDATE timeline_messages SET source_context_json=NULL WHERE seq=:seq").run({ seq: entry.seq })).toThrow();
  });

  it("frames actual gate/extraction input but leaves original text and UTF-16 slices exact for native retain", async () => {
    const f = fixture();
    const entries: TimelineEntry[] = [f.timeline.append({ characterId: "taki", role: "user", content: "视频叙述者说‘我失业了’。", sourceContext }),
      f.timeline.append({ characterId: "taki", role: "user", content: "我没有失业，但我的项目停了。🙂" })];
    f.repo.recordPrimaryCommitted({ ...f.scope, entries });
    const span = sanitizeCommittedPrimarySpan({ characterId: "taki", fromSeq: 0, throughSeq: 2,
      entries: f.repo.pendingEntries({ ...f.scope, throughSeq: 2 }) });
    const model = scriptedGenerateModel([{ kind: "text", deltas: [JSON.stringify({ decision: "keep", route: "character", fromSeq: 1, throughSeq: 2 })] },
      { kind: "text", deltas: [JSON.stringify([{ layer: "episodes", content: "我记得我们讨论叙述者失业；用户只说自己的项目停了。", importance: 5 }])] }]);
    const consumer = createCanonicalIngestionModel(createUtilitySlot({ mainModel: model, logger: createCaptureLogger().logger }));
    const gate = await consumer.gate(span); if (gate.decision !== "keep") throw new Error("fixture gate");
    await consumer.extract({ source: span, gate });
    expect(model.doGenerateCalls).toHaveLength(2);
    for (const call of model.doGenerateCalls) {
      expect(JSON.stringify(call.prompt)).toContain("Narrator");
      expect(JSON.stringify(call.prompt)).toContain("explicit user self-report remains a self-report");
      expect(JSON.stringify(call.prompt)).toContain(entries[1]!.content);
    }
    const original = retainedIngestionSource(span.messages);
    expect(original.text).toBe(entries.map((entry) => entry.content).join("\n"));
    original.entries.forEach((entry, index) => expect(original.text.slice(entry.utf16Start, entry.utf16Start + entry.utf16Length)).toBe(entries[index]!.content));
    expect(original.entries[0]?.sourceContext).toEqual(sourceContext); expect(original.entries[1]).not.toHaveProperty("sourceContext");
    const state = HindsightIngestionStateSchema.parse({ epochId: "native", providerLineageId: LINEAGE, characterId: "taki", spanId: "span",
      sourceHash: ingestionSourceDigest(span), source: span, gate, batches: [], receipts: [], state: "pending", revision: 1, createdAt: AT, updatedAt: AT });
    const batch = prepareHindsightIngestionBatch(state, { bank: { bankId: "native-bank", scope: "character", characterId: "taki" },
      providerLineageId: LINEAGE, bankGeneration: LINEAGE, baseCursor: 0 });
    expect(batch.request.content).toBe(original.text);
    expect(batch.request.metadata["taki:conversation-source:v1"]).toMatchObject({ entries: original.entries });
    expect(ingestionSourceDigest({ ...span, messages: span.messages.map((message) => ({ ...message, sourceContext: undefined })) })).not.toBe(ingestionSourceDigest(span));
  });
});
