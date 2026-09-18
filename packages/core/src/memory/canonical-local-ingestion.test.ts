import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import type { TimelineEntry } from "@taki/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanonicalIngestionRepo } from "../db/canonical-ingestion-repo.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../db/canonical-memory-maintenance-repo.ts";
import { createCanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import { createCanonicalMemorySparseRepo } from "../db/canonical-memory-sparse-repo.ts";
import { createMemoryAutoRepo } from "../db/memory-auto-repo.ts";
import { createMemoryEventsRepo } from "../db/memory-events-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { failingGenerateModel, generatingModel, scriptedGenerateModel } from "../testing/mock-language-model.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createCanonicalLocalIngestion } from "./canonical-local-ingestion.ts";
import { createLocalMemoryProvider } from "./local-memory-provider.ts";
import { createIntlSegmenterTokenizer } from "./search-tokenizer.ts";
import { createUtilitySlot } from "./utility-slot.ts";

const AT = "2026-09-11T00:00:00.000Z";
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); vi.restoreAllMocks(); });

function script(...values: unknown[]) {
  return scriptedGenerateModel(values.map((value) => ({ kind: "text", deltas: [typeof value === "string" ? value : JSON.stringify(value)] })));
}
function keep(route: "global" | "character" | "both", fromSeq = 1, throughSeq = 2) {
  return { decision: "keep", route, fromSeq, throughSeq };
}
function fact(layer = "episodes", content = "我记得他说「很烦」。", importance = 5) {
  return { layer, content, importance, disclosure: "很烦" };
}

function fixture(model: LanguageModel, path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS });
  let closed = false;
  const close = () => { if (!closed) { db.close(); closed = true; } };
  cleanup.push(close);
  const authority = createCanonicalMemoryAuthorityRepo(db);
  const epoch = authority.initializeLocalAuthority(AT);
  for (const [bankId, characterId] of [["global", null], ["character:taki", "taki"], ["character:other", "other"]] as const) {
    if (!authority.getBank(epoch.epochId, bankId)) authority.createBank({ authorityEpochId: epoch.epochId, bankId,
      scope: characterId === null ? { kind: "global", characterId: null } : { kind: "character", characterId },
      name: bankId, disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "test memory", config: {} });
  }
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: true });
  const records = createCanonicalMemoryRepo(db);
  const maintenance = createCanonicalMemoryMaintenanceRepo(db, tokenizer);
  const provider = createLocalMemoryProvider({ authority, records, maintenance, tokenizer,
    sparse: createCanonicalMemorySparseRepo(db), now: () => AT });
  const timeline = createTimelineRepo(db);
  const autoState = createMemoryAutoRepo(db);
  const events = createMemoryEventsRepo(db);
  const journal = createCanonicalIngestionRepo({ db, maintenance });
  const captured = createCaptureLogger();
  const slot = createUtilitySlot({ mainModel: model, logger: captured.logger });
  const ingestion = createCanonicalLocalIngestion({ provider, authority, maintenance, journal, timeline, autoState,
    events, slot, now: () => AT });
  const scope = { epochId: epoch.epochId, characterId: "taki" };
  function primary(user = "我最近工作卡住了，真的很烦", assistant = "我会记得你说的「很烦」"): TimelineEntry[] {
    const entries = [timeline.append({ characterId: "taki", role: "user", content: user }),
      timeline.append({ characterId: "taki", role: "assistant", content: assistant })];
    ingestion.recordPrimaryCommitted({ characterId: "taki", entries });
    return entries;
  }
  return { db, close, authority, epoch, records, maintenance, provider, timeline, autoState, events, journal,
    slot, ingestion, scope, primary, logs: captured.records };
}

function retirement(throughSeq: number) {
  return { characterId: "taki", fromSeq: 1, throughSeq, operationId: `compact:${throughSeq}` };
}

describe("canonical Local automatic ingestion", () => {
  it("uses one shared-slot gate, keeps the approved original source apart from multiple facts, and recalls without embeddings", async () => {
    const model = script(keep("character"), [fact(), fact("intentions", "我想下次问他工作是否还「卡住了」。", 10)]);
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    const original = f.primary();
    const result = await f.ingestion.run({ characterId: "taki" });
    expect(result).toMatchObject({ throughSeq: 2, writes: 2, sources: 1, reinforced: 0 });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(f.slot.usage()).toEqual({ calls: 2, inputTokens: 6, outputTokens: 10, usageUnknown: 0 });
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain("Make exactly one keep/skip decision");
    const extractionPrompt = JSON.stringify(model.doGenerateCalls[1]?.prompt);
    expect(extractionPrompt).toContain("FIRST PERSON");
    expect(extractionPrompt).toContain("user's actual words");
    expect(extractionPrompt).not.toContain("That is the whole test");
    const rows = f.maintenance.list(f.scope);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.policy.importance <= 7 && row.unit.metadata && Object.keys(row.unit.metadata).length === 0)).toBe(true);
    const source = f.maintenance.source({ ...f.scope, bankId: "character:taki", documentId: rows[0]!.unit.documentId! });
    expect(source?.retainedText).toContain(original[0]!.content);
    expect(source?.retainedText).toContain(original[1]!.content);
    expect(source?.retainedText).not.toContain("我想下次问他");
    expect(source?.provenance).toMatchObject({ origin: "auto-gate", characterId: "taki", timelineFromSeq: 1, timelineToSeq: 2 });
    expect(JSON.stringify(source?.metadata)).not.toContain("我记得他说");
    const recall = await f.provider.recall({ authorityEpochId: f.epoch.epochId, requestId: "recall", actor: "foreground-agent" },
      { bankId: "character:taki", query: "很烦", queryTimestamp: null, budget: "low", limit: 10, maxTokens: 1_000,
        factTypes: ["experience", "world"], layerIds: [], includeInvalidated: false });
    expect(recall).toMatchObject({ ok: true, data: { returned: 2, vectorState: "unavailable" } });
    expect(f.autoState.get("taki")).toMatchObject({ lastEpisodicSeq: 2, lastFlushSeq: 2 });
    await expect(f.ingestion.flushPort.prepareRetirement(retirement(2))).resolves.toMatchObject({ status: "success", writes: 0 });
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it.each(["global", "character", "both"] as const)("respects the %s route and never writes another Character's Bank", async (route) => {
    const facts = route === "global" ? [fact("profile")] : route === "character" ? [fact()] : [fact("profile"), fact()];
    const model = script(keep(route), facts);
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    f.primary();
    await f.ingestion.run({ characterId: "taki" });
    const bankIds = f.maintenance.list(f.scope).map((row) => row.unit.bankId).sort();
    expect(bankIds).toEqual(route === "both" ? ["character:taki", "global"] : [route === "global" ? "global" : "character:taki"]);
    expect(f.maintenance.list({ epochId: f.epoch.epochId, characterId: "other" }).filter((row) => row.unit.bankId === "character:other")).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("excludes autonomous delivery, tool payloads, recalled/hidden envelopes and credentials before gate, plan or retain", async () => {
    const model = script(keep("global", 1, 6), [fact("profile", "我记得他说喜欢拉面。", 10)]);
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    const user = f.timeline.append({ characterId: "taki", role: "user", content: "我喜欢拉面<turn-context>PRIVATE_RECALL_PAYLOAD</turn-context>" });
    const secret = f.timeline.append({ characterId: "taki", role: "user", content: "api_key = sk-proj-PRIVATE_CREDENTIAL_123456789" });
    const tool = f.timeline.append({ characterId: "taki", role: "tool", content: "PRIVATE_TOOL_DISPLAY", parts: [
      { type: "tool-result", toolCallId: "x", toolName: "files_read", output: { type: "json", value: { secret: "PRIVATE_TOOL_PAYLOAD" } } },
    ] });
    f.timeline.append({ characterId: "taki", role: "assistant", content: "PRIVATE_AUTONOMOUS_SPEECH" });
    const hidden = f.timeline.append({ characterId: "taki", role: "user", content: "<system-reminder>PRIVATE_HIDDEN_PROMPT</system-reminder>" });
    const assistant = f.timeline.append({ characterId: "taki", role: "assistant", content: "PRIVATE_DISPLAY_PROJECTION", parts: [
      { type: "text", text: "我会记得你喜欢拉面" }, { type: "tool-call", toolCallId: "y", toolName: "memory_recall", input: "PRIVATE_TOOL_INPUT" },
    ] });
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: [user, secret, tool, hidden, assistant] });
    await f.ingestion.run({ characterId: "taki" });
    const persisted = JSON.stringify(f.db.prepare("SELECT source_json,gate_json,extraction_json FROM canonical_memory_ingestion_spans").all())
      + JSON.stringify(f.db.prepare("SELECT retained_text,metadata_json FROM canonical_memory_sources").all());
    expect(persisted).toContain("我喜欢拉面");
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("PRIVATE_");
    expect(persisted).not.toContain("PRIVATE_");
    expect(JSON.stringify(f.logs)).not.toContain("PRIVATE_");
    expect(f.maintenance.list(f.scope)[0]?.policy.importance).toBeLessThan(9);
  });

  it("lexically reinforces without another classifier or overwriting original provenance and retains the later occurrence", async () => {
    const model = script(keep("character"), [fact()], keep("character", 3, 4), [fact("episodes", "我记得他说「很烦」", 7)]);
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    f.primary();
    await f.ingestion.run({ characterId: "taki" });
    const first = f.maintenance.list(f.scope)[0]!;
    const originalSource = f.maintenance.source({ ...f.scope, bankId: first.unit.bankId, documentId: first.unit.documentId! });
    f.primary("又过了一天，我还是很烦", "我记住了，这件事仍然影响你");
    const result = await f.ingestion.run({ characterId: "taki" });
    const records = f.maintenance.list(f.scope);
    expect(result).toMatchObject({ writes: 1, reinforced: 1, sources: 1 });
    expect(records).toHaveLength(1);
    expect(records[0]?.unit).toMatchObject({ memoryId: first.unit.memoryId, documentId: first.unit.documentId, proofCount: 2, revision: 2 });
    expect(records[0]?.provenance).toEqual(first.provenance);
    expect(f.maintenance.source({ ...f.scope, bankId: first.unit.bankId, documentId: first.unit.documentId! })).toEqual(originalSource);
    expect(f.db.prepare("SELECT document_id FROM canonical_memory_sources").all()).toHaveLength(2);
    const evidence = f.maintenance.evidenceSources({ ...f.scope, bankId: first.unit.bankId, memoryId: first.unit.memoryId });
    expect(evidence.some((source) => source.retainedText?.includes("又过了一天"))).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(4);
    await f.ingestion.run({ characterId: "taki" });
    expect(f.maintenance.list(f.scope)[0]?.unit.proofCount).toBe(2);
  });

  it("reopens a both-Bank partial success with its exact gate/facts/receipts and does not reinforce the successful Bank twice", async () => {
    const root = mkdtempSync(join(tmpdir(), "taki-ingestion-restart-"));
    cleanup.push(() => rmTempDir(root));
    const path = join(root, "memory.sqlite");
    const model = script(keep("both"), [fact("profile"), fact()]);
    const first = fixture(model, path);
    first.ingestion.initializeBaseline("taki");
    first.primary();
    first.db.exec(`CREATE TRIGGER fail_character_source BEFORE INSERT ON canonical_memory_sources
      WHEN NEW.bank_id='character:taki' BEGIN SELECT RAISE(ABORT,'controlled source failure'); END`);
    await expect(first.ingestion.run({ characterId: "taki" })).rejects.toThrow("MEMORY_INTERNAL_ERROR");
    expect(first.journal.cursor(first.scope)).toBe(0);
    expect(first.autoState.get("taki")).toMatchObject({ lastEpisodicSeq: 0, lastFlushSeq: 0 });
    expect(first.maintenance.list(first.scope)).toHaveLength(1);
    expect(model.doGenerateCalls).toHaveLength(2);
    first.close();

    const unusedModel = generatingModel("must not be called");
    const resumed = fixture(unusedModel, path);
    resumed.db.exec("DROP TRIGGER fail_character_source");
    resumed.primary("new conversation must not replace the pending span", "later");
    const ingest = vi.spyOn(resumed.provider, "ingest");
    await expect(resumed.ingestion.run({ characterId: "taki", throughSeq: 2 })).resolves.toMatchObject({ throughSeq: 2, writes: 2, sources: 2 });
    expect(ingest.mock.calls.map(([, batch]) => batch.bankId)).toEqual(["character:taki"]);
    expect(unusedModel.doGenerateCalls).toHaveLength(0);
    const records = resumed.maintenance.list(resumed.scope);
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.unit.proofCount === 1 && record.unit.revision === 1)).toBe(true);
    expect(resumed.journal.cursor(resumed.scope)).toBe(2);
    expect(resumed.db.prepare("SELECT from_seq,through_seq FROM canonical_memory_ingestion_spans").all()).toEqual([{ from_seq: 0, through_seq: 2 }]);
  });

  it("reads the actual Bank receipt after a lost journal acknowledgement instead of submitting that Bank again", async () => {
    const model = script(keep("character"), [fact()]);
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    f.primary();
    f.db.exec(`CREATE TRIGGER lose_ack BEFORE UPDATE OF bank_receipts_json ON canonical_memory_ingestion_spans
      WHEN NEW.bank_receipts_json != '[]' BEGIN SELECT RAISE(ABORT,'lost journal acknowledgement'); END`);
    const ingest = vi.spyOn(f.provider, "ingest");
    await expect(f.ingestion.run({ characterId: "taki" })).rejects.toThrow();
    expect(f.maintenance.list(f.scope)).toHaveLength(1);
    expect(f.journal.cursor(f.scope)).toBe(0);
    f.db.exec("DROP TRIGGER lose_ack");
    await f.ingestion.run({ characterId: "taki" });
    expect(ingest).toHaveBeenCalledOnce();
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(f.maintenance.list(f.scope)[0]?.unit.proofCount).toBe(1);
  });

  it("rolls back completion, both visible watermarks and decision events when the completion write fails", async () => {
    const model = script({ decision: "skip" });
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    f.primary();
    f.db.exec(`CREATE TRIGGER fail_completion BEFORE UPDATE OF state ON canonical_memory_ingestion_spans
      WHEN NEW.state='complete' BEGIN SELECT RAISE(ABORT,'controlled completion failure'); END`);
    await expect(f.ingestion.run({ characterId: "taki" })).rejects.toThrow();
    expect(f.journal.cursor(f.scope)).toBe(0);
    expect(f.autoState.get("taki")).toMatchObject({ lastEpisodicSeq: 0, lastFlushSeq: 0 });
    expect(f.events.listByCharacter({ characterId: "taki", limit: 10 })).toEqual([]);
    f.db.exec("DROP TRIGGER fail_completion");
    await f.ingestion.run({ characterId: "taki" });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(f.journal.cursor(f.scope)).toBe(2);
    expect(f.events.listByCharacter({ characterId: "taki", limit: 10 })).toHaveLength(1);
  });

  it.each(["skip", "empty"] as const)("settles %s truthfully and shares the decision with concurrent flush", async (scenario) => {
    const model = scenario === "skip" ? script({ decision: "skip" }) : script(keep("character"), []);
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    f.primary();
    const results = await Promise.all([f.ingestion.run({ characterId: "taki" }), f.ingestion.flushPort.prepareRetirement(retirement(2))]);
    expect(results[0]).toMatchObject({ throughSeq: 2, writes: 0, sources: scenario === "empty" ? 1 : 0 });
    expect(results[1]).toMatchObject({ status: "success", writes: 0, throughSeq: 2 });
    expect(model.doGenerateCalls).toHaveLength(scenario === "skip" ? 1 : 2);
    expect(f.maintenance.list(f.scope)).toEqual([]);
    expect(f.db.prepare("SELECT document_id FROM canonical_memory_sources").all()).toHaveLength(scenario === "empty" ? 1 : 0);
  });

  it("keeps failed model work pending without leaking its error or advancing a watermark", async () => {
    const f = fixture(failingGenerateModel(new Error("PRIVATE_PROVIDER_BODY api_key=PRIVATE_KEY")));
    f.ingestion.initializeBaseline("taki");
    f.primary();
    await expect(f.ingestion.run({ characterId: "taki" })).rejects.toThrow("MEMORY_INGESTION_GATE_FAILED");
    expect(f.journal.cursor(f.scope)).toBe(0);
    expect(f.journal.pending(f.scope)?.gate).toBeNull();
    expect(f.maintenance.list(f.scope)).toEqual([]);
    expect(JSON.stringify(f.logs)).not.toContain("PRIVATE_");
  });

  it("uses a persistent eligibility baseline without inventing old primary evidence or old gate completion", async () => {
    const model = script(keep("character", 3, 4), [fact()]);
    const f = fixture(model);
    f.timeline.append({ characterId: "taki", role: "user", content: "historical provenance unknown" });
    f.timeline.append({ characterId: "taki", role: "assistant", content: "old answer" });
    f.ingestion.initializeBaseline("taki");
    expect(f.journal.eligibilityStartSeq(f.scope)).toBe(3);
    expect(f.journal.cursor(f.scope)).toBe(0);
    await expect(f.ingestion.flushPort.prepareRetirement(retirement(2))).resolves.toEqual({
      status: "not_required", reason: "before_canonical_ingestion_eligibility",
    });
    expect(f.db.prepare("SELECT * FROM canonical_memory_ingestion_spans").all()).toEqual([]);
    expect(f.db.prepare("SELECT * FROM canonical_memory_primary_commits").all()).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(0);
    f.primary();
    f.ingestion.initializeBaseline("taki");
    expect(f.journal.eligibilityStartSeq(f.scope)).toBe(3);
    await f.ingestion.run({ characterId: "taki" });
    expect(f.journal.cursor(f.scope)).toBe(4);
    expect(f.db.prepare("SELECT timeline_seq FROM canonical_memory_primary_commits ORDER BY timeline_seq").all()).toEqual([
      { timeline_seq: 3 }, { timeline_seq: 4 },
    ]);
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("historical provenance unknown");
  });

  it("refuses an unresolved primary witness gap after the baseline until the exact commit is recorded", async () => {
    const model = script({ decision: "skip" });
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    const missing = [f.timeline.append({ characterId: "taki", role: "user", content: "not witnessed yet" }),
      f.timeline.append({ characterId: "taki", role: "assistant", content: "a committed reply" })];
    await expect(f.ingestion.flushPort.prepareRetirement(retirement(2))).resolves.toMatchObject({ status: "retryable_failure" });
    expect(f.journal.cursor(f.scope)).toBe(0);
    expect(model.doGenerateCalls).toHaveLength(0);
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: missing });
    await expect(f.ingestion.flushPort.prepareRetirement(retirement(2))).resolves.toMatchObject({ status: "success", throughSeq: 2 });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it.each(["before-baseline", "before-covered-cursor"] as const)("ingests a late positive primary commit %s exactly once", async (scenario) => {
    const laterDecision = scenario === "before-covered-cursor"
      ? [keep("character", 3, 4), [fact("episodes", "I remember the later dinner plan.")]] : [];
    const model = script(...laterDecision, keep("character", 1, 2), [fact("episodes", "I remember their earlier cafe preference.")]);
    const f = fixture(model);
    const earlier = [f.timeline.append({ characterId: "taki", role: "user", content: "I prefer quiet cafes" }),
      f.timeline.append({ characterId: "taki", role: "assistant", content: "I will remember the quiet cafe preference" })];
    f.ingestion.initializeBaseline("taki");
    expect(f.journal.eligibilityStartSeq(f.scope)).toBe(3);
    if (scenario === "before-covered-cursor") {
      f.primary("We can make dinner later", "I remember the dinner plan");
      await f.ingestion.run({ characterId: "taki" });
      expect(f.journal.cursor(f.scope)).toBe(4);
    }
    // Primary completion may be delivered after a baseline or a newer span was
    // processed. The positive witness remains new work regardless of its seq.
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: earlier, runId: "late-primary" });
    expect(f.journal.unprocessedCount(f.scope)).toBe(2);
    await expect(f.ingestion.flushPort.prepareRetirement(retirement(2))).resolves.toMatchObject({ status: "success", writes: 1 });
    expect(f.journal.unprocessedCount(f.scope)).toBe(0);
    expect(f.journal.cursor(f.scope)).toBe(scenario === "before-covered-cursor" ? 4 : 2);
    const row = f.maintenance.list(f.scope).find((record) => record.unit.text === "I remember their earlier cafe preference.")!;
    expect(f.maintenance.source({ ...f.scope, bankId: row.unit.bankId, documentId: row.unit.documentId! })?.retainedText)
      .toBe(earlier.map((entry) => entry.content).join("\n"));
    const claims = f.db.prepare(`SELECT authority_epoch_id,ingestion_span_id,committed_through_seq
      FROM canonical_memory_primary_commits WHERE timeline_seq<=2 ORDER BY timeline_seq`).all();
    expect(claims).toEqual(Array.from({ length: 2 }, () => ({ authority_epoch_id: f.epoch.epochId,
      ingestion_span_id: expect.any(String), committed_through_seq: 2 })));
    expect(claims[0]?.ingestion_span_id).toBe(claims[1]?.ingestion_span_id);
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: earlier, runId: "late-primary" });
    await expect(f.ingestion.run({ characterId: "taki" })).resolves.toMatchObject({ writes: 0 });
    expect(model.doGenerateCalls).toHaveLength(scenario === "before-covered-cursor" ? 4 : 2);
    expect(f.maintenance.list(f.scope).find((record) => record.unit.memoryId === row.unit.memoryId)?.unit.proofCount).toBe(1);
  });

  it("uses twenty pending primary messages rather than Timeline distance, autonomous delivery, or another Character", async () => {
    const model = script({ decision: "skip" }, { decision: "skip" });
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    f.ingestion.initializeBaseline("other");
    for (let index = 0; index < 30; index += 1) {
      f.timeline.append({ characterId: "taki", role: "assistant", content: "AUTONOMOUS_NOT_PRIMARY" });
    }
    for (let index = 0; index < 9; index += 1) f.primary(`Primary message ${index}`, `Primary reply ${index}`);
    const other = [f.timeline.append({ characterId: "other", role: "user", content: "OTHER_CHARACTER_PRIMARY" }),
      f.timeline.append({ characterId: "other", role: "assistant", content: "OTHER_CHARACTER_REPLY" })];
    f.ingestion.recordPrimaryCommitted({ characterId: "other", entries: other });
    expect(f.timeline.latestSeq("taki")).toBeGreaterThan(20);
    expect(f.journal.unprocessedCount(f.scope)).toBe(18);
    await expect(f.ingestion.maybeRun({ characterId: "taki" })).resolves.toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
    f.primary("The twentieth-message conversation", "This reaches the existing cadence");
    expect(f.journal.unprocessedCount(f.scope)).toBe(20);
    await expect(f.ingestion.maybeRun({ characterId: "taki" })).resolves.toMatchObject({ skippedSpans: 1 });
    expect(f.journal.unprocessedCount(f.scope)).toBe(0);
    expect(f.journal.unprocessedCount({ ...f.scope, characterId: "other" })).toBe(2);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("AUTONOMOUS_NOT_PRIMARY");
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("OTHER_CHARACTER_");
    for (let index = 0; index < 9; index += 1) f.primary(`Next pending ${index}`, `Next reply ${index}`);
    await expect(f.ingestion.maybeRun({ characterId: "taki" })).resolves.toBeNull();
    expect(model.doGenerateCalls).toHaveLength(1);
    await expect(f.ingestion.flushPort.prepareRetirement(retirement(f.timeline.latestSeq("taki"))))
      .resolves.toMatchObject({ status: "success", writes: 0 });
    expect(f.journal.unprocessedCount(f.scope)).toBe(0);
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("retries a failed claimed span immediately below the cadence without repeating gate or extraction", async () => {
    const model = script(keep("character"), [fact()]);
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    f.primary();
    f.db.exec(`CREATE TRIGGER reject_cadence_source BEFORE INSERT ON canonical_memory_sources
      BEGIN SELECT RAISE(ABORT,'controlled source failure'); END`);
    await expect(f.ingestion.run({ characterId: "taki" })).rejects.toThrow("MEMORY_INTERNAL_ERROR");
    expect(f.journal.pending(f.scope)?.source.proofs).toHaveLength(2);
    expect(f.journal.unprocessedCount(f.scope)).toBe(0);
    expect(f.journal.cursor(f.scope)).toBe(0);
    f.db.exec("DROP TRIGGER reject_cadence_source");
    const results = await Promise.all([f.ingestion.maybeRun({ characterId: "taki" }), f.ingestion.maybeRun({ characterId: "taki" })]);
    expect(results).toEqual([expect.objectContaining({ throughSeq: 2, writes: 1, sources: 1 }), null]);
    expect(f.journal.pending(f.scope)).toBeUndefined();
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(f.maintenance.list(f.scope)[0]?.unit).toMatchObject({ proofCount: 1, revision: 1 });
  });

  it("retains an exactly supported maximum-size source without spending its content budget on prompt framing", async () => {
    const model = script(keep("character", 1, 1), [fact("episodes", "我记得他发来了一长串 x。")]);
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    const content = "x".repeat(100_000);
    const entry = f.timeline.append({ characterId: "taki", role: "user", content });
    f.ingestion.recordPrimaryCommitted({ characterId: "taki", entries: [entry] });
    await f.ingestion.run({ characterId: "taki" });
    const row = f.maintenance.list(f.scope)[0]!;
    const source = f.maintenance.source({ ...f.scope, bankId: row.unit.bankId, documentId: row.unit.documentId! });
    expect(source?.retainedText).toBe(content);
    expect(source?.metadata["taki:conversation-source:v1"]).toMatchObject({ entries: [
      { seq: 1, role: "user", utf16Start: 0, utf16Length: 100_000 },
    ] });
    expect(f.journal.cursor(f.scope)).toBe(1);
  });

  it("re-prepares a stale duplicate revision from durable facts without rerunning gate or extraction", async () => {
    const model = script(keep("character"), [fact()], keep("character", 3, 4), [fact()]);
    const f = fixture(model);
    f.ingestion.initializeBaseline("taki");
    f.primary();
    await f.ingestion.run({ characterId: "taki" });
    f.primary("仍然很烦", "我仍然记得");
    const original = f.provider.ingest.bind(f.provider);
    let raced = false;
    vi.spyOn(f.provider, "ingest").mockImplementation(async (context, batch) => {
      if (!raced && batch.duplicates.length > 0) {
        raced = true;
        const duplicate = batch.duplicates[0]!;
        f.maintenance.reinforce({ ...f.scope, bankId: batch.bankId, memoryId: duplicate.memoryId,
          expectedRevision: duplicate.expectedRevision, requestId: "parallel-tidy", mode: "tidy", now: AT });
      }
      return original(context, batch);
    });
    await f.ingestion.run({ characterId: "taki" });
    expect(raced).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(4);
    expect(f.maintenance.list(f.scope)).toHaveLength(1);
    expect(f.maintenance.list(f.scope)[0]?.unit).toMatchObject({ proofCount: 3, revision: 3 });
    expect(f.journal.cursor(f.scope)).toBe(4);
  });
});
