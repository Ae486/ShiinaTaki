import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "../db/canonical-memory-repo.ts";
import { createMemoryAutoRepo } from "../db/memory-auto-repo.ts";
import { createMemoryEventsRepo } from "../db/memory-events-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createStructuredMemoryBlockRepo } from "../db/structured-memory-block-repo.ts";
import { loadMemoryConfig } from "../config/memory-config.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { scriptedGenerateModel } from "../testing/mock-language-model.ts";
import { createCanonicalLocalRuntime } from "./canonical-local-runtime.ts";
import { canonicalMemoryRow } from "./canonical-memory-view.ts";
import { canonicalLayerRetention } from "./canonical-layer-policy.ts";
import { getLayer } from "./layer-registry.ts";
import type { TidyEngineView } from "./memory-engine.ts";
import { createTidyPass } from "./tidy-pass.ts";
import { createUtilitySlot } from "./utility-slot.ts";

const AT = "2020-01-01T00:00:00.000Z";
const opened: Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

function fresh() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  opened.push(db);
  const authority = createCanonicalMemoryAuthorityRepo(db);
  const epoch = authority.initializeLocalAuthority(AT);
  const engine = createCanonicalLocalRuntime({ db, epochId: epoch.epochId });
  const banks = engine.banks("taki");
  const records = createCanonicalMemoryRepo(db);
  const seed = async (input: { layer?: string; content?: string; importance?: number } = {}) => {
    const layer = getLayer(input.layer ?? "episodes")!;
    const bankId = layer.ownership === "global" ? banks.global.bankId : banks.character.bankId;
    const requestId = `seed-${db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()!.n}`;
    const result = await engine.provider.retain({ requestId, authorityEpochId: epoch.epochId, actor: "foreground-agent" }, {
      bankId, content: input.content ?? "the original user wording", context: "original context", timestamp: AT,
      tags: ["original-tag"], entities: ["user"], metadata: { original: { kept: true } }, observationScopes: null,
      documentId: null, strategy: null, updateMode: "replace",
      provenance: { actor: "agent", origin: "explicit-agent", characterId: "taki", timelineFromSeq: null,
        timelineToSeq: null, capturedAt: AT, sanitized: true, sourceRef: "original-source" },
      policy: { layerId: layer.id, importance: input.importance ?? 5, visibility: layer.recallPolicy,
        disclosure: "old trigger", origin: "self", emotionalWeight: null,
        retention: canonicalLayerRetention({ layer, at: AT }), policyVersion: 1 },
    });
    if (!result.ok) throw new Error(result.error.code);
    return records.record(epoch.epochId, bankId, result.data.memories[0]!.memoryId)!;
  };
  return { db, authority, epoch, engine, banks, records, seed };
}

async function invoke(view: TidyEngineView, name: string, input: Record<string, unknown>) {
  const execute = view.createTools("taki")[name]?.execute;
  if (!execute) throw new Error("missing canonical maintenance tool");
  return await execute(input, { toolCallId: name, messages: [], context: {} }) as {
    ok: boolean; code?: string; id?: string; memoryId?: string; bankId?: string; revision?: number;
  };
}

describe("Canonical Local persisted maintenance", () => {
  it("projects actual persisted visibility instead of reconstructing it only from the layer", async () => {
    const fixture = fresh();
    const hidden = await fixture.seed({ layer: "profile", content: "hidden identity", importance: 9 });
    const pinned = await fixture.seed({ layer: "profile", content: "deliberate pin", importance: 5 });
    for (const [record, visibility] of [[hidden, "hidden"], [pinned, "pinned"]] as const) {
      fixture.engine.maintenanceStore.policyEdit({ epochId: fixture.epoch.epochId, bankId: record.unit.bankId,
        characterId: "taki", memoryId: record.unit.memoryId, expectedRevision: 1, requestId: visibility,
        now: "2026-09-11T00:00:00.000Z", patch: { visibility } });
    }
    const captured = await fixture.engine.captureRun("taki");
    expect(captured.assemble?.("")).not.toContain("hidden identity");
    expect(captured.assemble?.("")).toContain("deliberate pin");
  });

  it("excludes hidden evidence from ordinary tidy counts, the captured report and the actual model prompt", async () => {
    const fixture = fresh();
    const hidden = await fixture.seed({ layer: "profile", content: "HIDDEN_RELATIONSHIP_EVIDENCE", importance: 9 });
    await fixture.seed({ content: "VISIBLE_REVIEW_CANDIDATE" });
    fixture.engine.maintenanceStore.policyEdit({ epochId: fixture.epoch.epochId, bankId: hidden.unit.bankId,
      characterId: "taki", memoryId: hidden.unit.memoryId, expectedRevision: 1, requestId: "hide-evidence",
      now: "2026-09-11T00:00:00.000Z", patch: { visibility: "hidden" } });
    const review = fixture.engine.tidy.captureReview!("taki");
    expect.soft(review.listActive("taki").map((row) => row.content)).toEqual(["VISIBLE_REVIEW_CANDIDATE"]);
    expect.soft(review.countSince("taki", null)).toBe(1);
    const model = scriptedGenerateModel([{ kind: "tool", toolCallId: "finish", toolName: "memory_finish_edits", input: {} }]);
    const { logger } = createCaptureLogger();
    const pass = createTidyPass({ view: { ...fixture.engine.tidy, captureReview: () => review },
      autoState: createMemoryAutoRepo(fixture.db), events: createMemoryEventsRepo(fixture.db), config: loadMemoryConfig({}), logger,
      slot: createUtilitySlot({ logger, mainModel: model }) });
    expect(await pass.runNow("taki")).toMatchObject({ status: "ran", edits: 0 });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(model.doGenerateCalls)).toContain("VISIBLE_REVIEW_CANDIDATE");
    expect.soft(JSON.stringify(model.doGenerateCalls).includes("HIDDEN_RELATIONSHIP_EVIDENCE"), "hidden evidence must not enter the model prompt").toBe(false);
    expect(fixture.records.record(fixture.epoch.epochId, hidden.unit.bankId, hidden.unit.memoryId))
      .toMatchObject({ unit: { state: "valid" }, policy: { visibility: "hidden" } });
  });

  it.each(["hidden", "later-global-sibling", "uncaptured-revision"] as const)("rejects a structurally valid %s tool reference outside this review", async (scenario) => {
    const fixture = fresh();
    await fixture.seed({ content: "The ordinary captured candidate" });
    const initial = scenario === "later-global-sibling" ? null : await fixture.seed({ layer: "profile", content: "Unapproved Global target" });
    if (scenario === "hidden" && initial) fixture.engine.maintenanceStore.policyEdit({ epochId: fixture.epoch.epochId,
      characterId: "taki", bankId: initial.unit.bankId, memoryId: initial.unit.memoryId, expectedRevision: 1,
      requestId: "hide-target", now: "2026-09-11T00:00:00.000Z", patch: { visibility: "hidden" } });
    const review = fixture.engine.tidy.captureReview!("taki");
    const candidate = initial ?? await fixture.seed({ layer: "profile", content: "Unreviewed later Global sibling" });
    if (scenario === "uncaptured-revision") fixture.engine.maintenanceStore.policyEdit({ epochId: fixture.epoch.epochId,
      characterId: "taki", bankId: candidate.unit.bankId, memoryId: candidate.unit.memoryId, expectedRevision: 1,
      requestId: "concurrent-policy", now: "2026-09-11T00:00:00.000Z", patch: { disclosure: "New revision from another pass" } });
    const current = fixture.records.record(fixture.epoch.epochId, candidate.unit.bankId, candidate.unit.memoryId)!;
    const forged = canonicalMemoryRow(current, null).id;
    expect(await invoke(review, "memory_set_disclosure", { id: forged, disclosure: "Must not be applied" }))
      .toMatchObject({ ok: false, code: "MEMORY_INVALID_REQUEST" });
    expect(fixture.records.record(fixture.epoch.epochId, candidate.unit.bankId, candidate.unit.memoryId)).toEqual(current);
    expect(review.reviewHealthy?.()).toBe(false);
  });

  it("allows this review to continue editing only references returned by its own successful operations", async () => {
    const fixture = fresh();
    const original = await fixture.seed({ layer: "profile" });
    const review = fixture.engine.tidy.captureReview!("taki");
    const initial = review.listActive("taki")[0]!.id;
    const refiled = await invoke(review, "memory_refile", { id: initial, layer: "episodes" });
    expect(refiled).toMatchObject({ ok: true, bankId: fixture.banks.character.bankId, revision: 1 });
    expect(review.listActive("taki").some((row) => row.id === refiled.id)).toBe(false);
    const changed = await invoke(review, "memory_set_disclosure", { id: refiled.id, disclosure: "Returned-reference edit" });
    expect(changed).toMatchObject({ ok: true, memoryId: refiled.memoryId, revision: 2 });
    const reinforced = await invoke(review, "memory_reinforce", { id: changed.id });
    expect(reinforced).toMatchObject({ ok: true, memoryId: refiled.memoryId, revision: 3 });
    expect(review.reviewHealthy?.()).toBe(true);
    expect(fixture.records.record(fixture.epoch.epochId, refiled.bankId!, refiled.memoryId!))
      .toMatchObject({ unit: { state: "valid", proofCount: original.unit.proofCount + 1 },
        policy: { disclosure: "Returned-reference edit" }, provenance: original.provenance });
  });

  it("advertises the same disclosure limit as the persisted policy schema", async () => {
    const fixture = fresh();
    await fixture.seed();
    const review = fixture.engine.tidy.captureReview!("taki");
    const id = review.listActive("taki")[0]!.id;
    const tools = review.createTools("taki");
    const disclosure = tools.memory_set_disclosure!.inputSchema as z.ZodType;
    const replacement = tools.memory_archive_supersede!.inputSchema as z.ZodType;
    expect(disclosure.safeParse({ id, disclosure: "x".repeat(512) }).success).toBe(true);
    expect(disclosure.safeParse({ id, disclosure: "x".repeat(513) }).success).toBe(false);
    expect(replacement.safeParse({ id, replacement: { layer: "episodes", content: "new", importance: 5,
      disclosure: "x".repeat(513) } }).success).toBe(false);
  });
  it("offers canonical foreground and private background tools and initializes a new Character scope once", async () => {
    const fixture = fresh();
    const first = fixture.engine.banks("second");
    const second = fixture.engine.banks("second");
    expect(first.character.bankId).toBe(second.character.bankId);
    expect(first.global.bankId).toBe(fixture.banks.global.bankId);
    const captured = await fixture.engine.captureRun("taki");
    expect(Object.keys(captured.tools)).toEqual(["retain", "recall", "update_memory", "invalidate_memory", "restore_memory"]);
    expect(Object.keys(fixture.engine.createBackgroundTools("taki"))).toContain("block_rethink");
    expect(captured.snapshot.authorityEpochId).toBe(fixture.epoch.epochId);
    expect(captured.snapshot.capabilities.vectorRetrieval).toBe("unavailable");
  });

  it("persists disclosure and FTS changes once and refuses a stale report revision", async () => {
    const fixture = fresh();
    const original = await fixture.seed();
    const review = fixture.engine.tidy.captureReview!("taki");
    const id = review.listActive("taki")[0]!.id;
    const changed = await invoke(review, "memory_set_disclosure", { id, disclosure: "orchid unique trigger" });
    expect(changed.ok).toBe(true);
    expect(await invoke(review, "memory_set_disclosure", { id, disclosure: "orchid unique trigger" })).toEqual(changed);
    expect(fixture.records.record(fixture.epoch.epochId, original.unit.bankId, original.unit.memoryId)?.unit.revision).toBe(2);
    const stale = await invoke(review, "memory_reinforce", { id });
    expect(stale).toMatchObject({ ok: false, code: "MEMORY_REVISION_MISMATCH" });
    expect(review.reviewHealthy?.()).toBe(false);
    const found = fixture.db.prepare("SELECT memory_id FROM canonical_memory_fts WHERE canonical_memory_fts MATCH 'orchid'").all();
    expect(found.map((row) => row.memory_id)).toEqual([original.unit.memoryId]);
  });

  it("atomically supersedes a fact while preserving its original source and opaque fields", async () => {
    const fixture = fresh();
    const original = await fixture.seed();
    const review = fixture.engine.tidy.captureReview!("taki");
    const result = await invoke(review, "memory_archive_supersede", { id: review.listActive("taki")[0]!.id,
      replacement: { layer: "episodes", content: "the corrected interpretation", importance: 7, disclosure: "new trigger" } });
    expect(result.ok).toBe(true);
    const replacement = fixture.records.record(fixture.epoch.epochId, original.unit.bankId, result.memoryId!)!;
    expect(replacement.unit.memoryId).not.toBe(original.unit.memoryId);
    expect(replacement.unit.documentId).toBe(original.unit.documentId);
    expect(replacement.unit.text).toBe("the corrected interpretation");
    expect(replacement.unit.metadata).toEqual(original.unit.metadata);
    expect(replacement.provenance).toEqual(original.provenance);
    expect(fixture.records.record(fixture.epoch.epochId, original.unit.bankId, original.unit.memoryId)?.unit.state).toBe("invalidated");
    const source = fixture.engine.maintenanceStore.source({ epochId: fixture.epoch.epochId, bankId: original.unit.bankId,
      characterId: "taki", documentId: replacement.unit.documentId! });
    expect(source?.retainedText).toBe("the original user wording");
  });

  it("rolls back archive, clone and text when the final replacement policy write fails", async () => {
    const fixture = fresh();
    const original = await fixture.seed();
    const review = fixture.engine.tidy.captureReview!("taki");
    fixture.db.exec("CREATE TRIGGER reject_tidy_policy BEFORE UPDATE ON canonical_memory_policy WHEN NEW.importance=9 BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    const result = await invoke(review, "memory_archive_supersede", { id: review.listActive("taki")[0]!.id,
      replacement: { layer: "episodes", content: "must not survive", importance: 9 } });
    expect(result.ok).toBe(false);
    expect(fixture.records.record(fixture.epoch.epochId, original.unit.bankId, original.unit.memoryId)).toEqual(original);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n).toBe(1);
    expect(fixture.db.prepare("SELECT count(*) AS n FROM canonical_memory_fts").get()?.n).toBe(1);
  });

  it("repairs a cross-Bank layer assignment with a new identity and preserved source provenance", async () => {
    const fixture = fresh();
    const original = await fixture.seed({ layer: "profile" });
    const review = fixture.engine.tidy.captureReview!("taki");
    const result = await invoke(review, "memory_refile", { id: review.listActive("taki")[0]!.id, layer: "episodes" });
    expect(result.ok).toBe(true);
    expect(result.bankId).toBe(fixture.banks.character.bankId);
    const copied = fixture.records.record(fixture.epoch.epochId, result.bankId!, result.memoryId!)!;
    expect(copied.unit.memoryId).not.toBe(original.unit.memoryId);
    expect(copied.provenance).toEqual(original.provenance);
    expect(copied.unit.metadata).toEqual(original.unit.metadata);
    expect(fixture.records.record(fixture.epoch.epochId, original.unit.bankId, original.unit.memoryId)?.unit.state).toBe("invalidated");
  });

  it("preserves a newer Block and the user card when a stale background review tries to replace them", async () => {
    const fixture = fresh();
    const blocks = createStructuredMemoryBlockRepo(fixture.db);
    blocks.replace({ blockId: "user-card", scope: { kind: "global", characterId: null }, actor: "user", content: "user truth" });
    const review = fixture.engine.tidy.captureReview!("taki");
    blocks.replace({ blockId: "user-model", scope: { kind: "global", characterId: null }, actor: "background", content: "newer model" });
    expect(await invoke(review, "block_rethink", { id: "user-model", content: "stale model" }))
      .toMatchObject({ ok: false, code: "MEMORY_REVISION_MISMATCH" });
    expect(await invoke(review, "block_rethink", { id: "user-card", content: "overwrite" }))
      .toMatchObject({ ok: false, code: "MEMORY_CAPABILITY_UNSUPPORTED" });
    expect(blocks.read("user-model", { kind: "global", characterId: null })?.content).toBe("newer model");
    expect(blocks.read("user-card", { kind: "global", characterId: null })?.content).toBe("user truth");
  });

  it("performs recoverable archival and machine-only hard deletion with actual durable counts", async () => {
    const fixture = fresh();
    const low = await fixture.seed({ content: "low episode", importance: 3 });
    const intention = await fixture.seed({ layer: "intentions", content: "expired intention" });
    const activity = await fixture.seed({ layer: "activity", content: "expired machine activity" });
    const important = await fixture.seed({ content: "important episode", importance: 9 });
    const relationship = await fixture.seed({ layer: "relationship", content: "permanent promise" });
    expect(fixture.engine.retentionSweep()).toEqual({ archived: 2, deleted: 1, failed: 0 });
    for (const item of [low, intention]) expect(fixture.records.record(fixture.epoch.epochId, item.unit.bankId, item.unit.memoryId)?.unit.state).toBe("invalidated");
    expect(fixture.records.record(fixture.epoch.epochId, activity.unit.bankId, activity.unit.memoryId)).toBeUndefined();
    for (const item of [important, relationship]) expect(fixture.records.record(fixture.epoch.epochId, item.unit.bankId, item.unit.memoryId)?.unit.state).toBe("valid");
    expect(fixture.engine.retentionSweep()).toBeUndefined();
  });

  it("does not advance the tidy watermark when a canonical CAS fails inside the real model loop", async () => {
    const fixture = fresh();
    const original = await fixture.seed();
    const review = fixture.engine.tidy.captureReview!("taki");
    const id = review.listActive("taki")[0]!.id;
    fixture.engine.maintenanceStore.reinforce({ epochId: fixture.epoch.epochId, bankId: original.unit.bankId,
      characterId: "taki", memoryId: original.unit.memoryId, expectedRevision: 1, requestId: "concurrent",
      now: "2026-09-10T00:00:00.000Z", mode: "tidy" });
    const model = scriptedGenerateModel([
      { kind: "tool", toolCallId: "stale", toolName: "memory_set_disclosure", input: { id, disclosure: "new" } },
      { kind: "tool", toolCallId: "finish", toolName: "memory_finish_edits", input: {} },
    ]);
    const { logger } = createCaptureLogger();
    const autoState = createMemoryAutoRepo(fixture.db);
    const pass = createTidyPass({ view: { ...fixture.engine.tidy, captureReview: () => review }, autoState,
      events: createMemoryEventsRepo(fixture.db), slot: createUtilitySlot({ mainModel: model, logger }), config: loadMemoryConfig({}), logger });
    expect((await pass.runNow("taki")).status).toBe("failed");
    expect(autoState.get("taki").lastTidyAt).toBeNull();
  });

  it("does not complete a stale-authority review even if the model only calls finish", async () => {
    const fixture = fresh();
    await fixture.seed();
    const review = fixture.engine.tidy.captureReview!("taki");
    fixture.db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:at WHERE epoch_id=:epoch")
      .run({ at: "2026-09-11T00:00:00.000Z", epoch: fixture.epoch.epochId });
    const { logger } = createCaptureLogger();
    const autoState = createMemoryAutoRepo(fixture.db);
    const pass = createTidyPass({ view: { ...fixture.engine.tidy, captureReview: () => review }, autoState,
      events: createMemoryEventsRepo(fixture.db), config: loadMemoryConfig({}), logger,
      slot: createUtilitySlot({ logger, mainModel: scriptedGenerateModel([
        { kind: "tool", toolCallId: "finish", toolName: "memory_finish_edits", input: {} },
      ]) }) });
    expect(await pass.runNow("taki")).toMatchObject({ status: "failed", edits: 0, steps: 1 });
    expect(autoState.get("taki").lastTidyAt).toBeNull();
  });

  it.each(["stale-cas", "later-model-failure"] as const)("retains actual completed edit/step counts after %s", async (failure) => {
    const fixture = fresh();
    const original = await fixture.seed();
    const review = fixture.engine.tidy.captureReview!("taki");
    const id = review.listActive("taki")[0]!.id;
    const script: Parameters<typeof scriptedGenerateModel>[0] = [
      { kind: "tool", toolCallId: "edit", toolName: "memory_set_disclosure", input: { id, disclosure: "persisted change" } },
    ];
    if (failure === "stale-cas") script.push(
      { kind: "tool", toolCallId: "stale", toolName: "memory_reinforce", input: { id } },
      { kind: "tool", toolCallId: "finish", toolName: "memory_finish_edits", input: {} },
    );
    const { logger } = createCaptureLogger();
    const autoState = createMemoryAutoRepo(fixture.db);
    const pass = createTidyPass({ view: { ...fixture.engine.tidy, captureReview: () => review }, autoState,
      events: createMemoryEventsRepo(fixture.db), config: loadMemoryConfig({}), logger,
      slot: createUtilitySlot({ logger, mainModel: scriptedGenerateModel(script) }) });
    expect(await pass.runNow("taki")).toMatchObject({ status: "failed", edits: 1, steps: failure === "stale-cas" ? 3 : 1 });
    expect(fixture.records.record(fixture.epoch.epochId, original.unit.bankId, original.unit.memoryId)?.policy.disclosure).toBe("persisted change");
    expect(autoState.get("taki").lastTidyAt).toBeNull();
  });

  it("persists image descriptions as observed source without automatic promotion or legacy storage", () => {
    const fixture = fresh();
    const written = fixture.engine.writeEntry({ characterId: "taki", type: "profile", content: "the image shows orchids",
      importance: 10, origin: "observed" });
    const record = fixture.records.record(fixture.epoch.epochId, fixture.banks.global.bankId, written.id)!;
    expect(record.policy.origin).toBe("observed");
    expect(record.policy.importance).toBeLessThan(9);
    expect(record.provenance.origin).toBe("machine-observed");
    expect(fixture.db.prepare("SELECT count(*) AS n FROM memory_entries").get()?.n).toBe(0);
    expect(() => fixture.engine.writeEntry({ characterId: "taki", type: "episodes", content: "old direct writer", importance: 5 }))
      .toThrow("MEMORY_LEGACY_WRITE_RETIRED");
  });
});
