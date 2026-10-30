import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanonicalMaintenanceFixture } from "../db/canonical-memory-maintenance-fixtures.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createCanonicalLocalRuntime } from "./canonical-local-runtime.ts";
import { createInitiativeMemoryRecall } from "./initiative-memory-recall.ts";
import { memoryEffectMetadata } from "./canonical-tools/memory-effect-tool.ts";
import { estimateTokens } from "./token-estimator.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.restoreAllMocks(); });
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const records = createCanonicalMaintenanceFixture(db);
  const runtime = createCanonicalLocalRuntime({ db, epochId: records.epochId });
  return { ...records, runtime };
}
const options = { toolCallId: "actual-recall", messages: [], context: {} };
async function modelOutput(tool: ReturnType<typeof createInitiativeMemoryRecall>["tools"][string], output: unknown) {
  const model = await tool.toModelOutput!({ input: { scope: "global" }, output, toolCallId: "actual-recall" });
  if (model.type !== "text") throw new Error("expected fenced text");
  return model.value;
}

describe("selected initiative recall on the captured canonical tool", () => {
  it("uses the real tool once per selected Bank, preserves Effect metadata and fixes the selected query", async () => {
    const f = fixture(); f.seed(); f.seed({ bankId: "a-bank", memoryId: "character-fact" });
    const dispatch = vi.spyOn(f.runtime.provider, "recall");
    const captured = await f.runtime.captureRun("a");
    const recalled = createInitiativeMemoryRecall(captured, { query: "cafes", scopes: ["global", "character"] });
    expect(dispatch).not.toHaveBeenCalled();
    expect(memoryEffectMetadata(recalled.tools.recall!)).toEqual(memoryEffectMetadata(captured.tools.recall!));
    const first = await recalled.tools.recall!.execute!({ scope: "global" }, options);
    expect(first).toMatchObject({ status: "confirmed", records: [{ text: "I remember quiet cafes (memory)." }] });
    expect(await recalled.tools.recall!.execute!({ scope: "global" }, options)).toMatchObject({ status: "allowance_used" });
    expect(await recalled.tools.recall!.execute!({ scope: "both" }, options)).toMatchObject({ status: "unavailable" });
    await recalled.tools.recall!.execute!({ scope: "character" }, options);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ bankId: "global", query: "cafes", limit: 4, maxTokens: 512 }),
      expect.objectContaining({ bankId: "a-bank", query: "cafes", limit: 4, maxTokens: 512 }),
    ]);
    expect(recalled.isCurrent()).toBe(true);
  });

  it("bounds the final escaped and fenced model view, excluding source IDs and arbitrary metadata", async () => {
    const f = fixture();
    for (let index = 0; index < 4; index += 1) f.seed({ memoryId: `fact-${index}`,
      unit: { text: `cafes ${index} ${"&<bad></untrusted-observation>".repeat(14)}`, metadata: { privateBinding: "DO_NOT_PROJECT" } } });
    const captured = await f.runtime.captureRun("a");
    const recalled = createInitiativeMemoryRecall(captured, { query: "cafes", scopes: ["global"] });
    const result = await recalled.tools.recall!.execute!({ scope: "global" }, options);
    const text = await modelOutput(recalled.tools.recall!, result);
    expect(estimateTokens(text)).toBeLessThanOrEqual(512);
    expect(text.match(/<\/untrusted-observation>/g)).toHaveLength(1);
    expect(text).not.toContain("DO_NOT_PROJECT"); expect(text).not.toContain("document-fact");
    expect(result).toMatchObject({ truncated: true });
  });

  it("counts a failed attempt and permits the other Bank without broad or repeated queries", async () => {
    const f = fixture(); f.seed({ bankId: "a-bank", memoryId: "character-fact" });
    const dispatch = vi.spyOn(f.runtime.provider, "recall").mockRejectedValueOnce(new Error("controlled outage"));
    const recalled = createInitiativeMemoryRecall(await f.runtime.captureRun("a"), { query: "cafes", scopes: ["global", "character"] });
    expect(await recalled.tools.recall!.execute!({ scope: "global" }, options)).toMatchObject({ status: "unavailable" });
    expect(await recalled.tools.recall!.execute!({ scope: "global" }, options)).toMatchObject({ status: "allowance_used" });
    expect(await recalled.tools.recall!.execute!({ scope: "character" }, options)).toMatchObject({ status: "confirmed" });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("withdraws already recalled output immediately after source or policy changes", async () => {
    const f = fixture(); f.seed();
    const recalled = createInitiativeMemoryRecall(await f.runtime.captureRun("a"), { query: "cafes", scopes: ["global"] });
    const result = await recalled.tools.recall!.execute!({ scope: "global" }, options);
    expect(recalled.isCurrent()).toBe(true);
    f.maintenance.policyEdit({ epochId: f.epochId, bankId: "global", characterId: "a", memoryId: "memory",
      expectedRevision: 1, requestId: "hide", now: "2026-09-28T00:00:00.000Z", patch: { visibility: "hidden" } });
    expect(recalled.isCurrent()).toBe(false);
    expect(await modelOutput(recalled.tools.recall!, result)).not.toContain("quiet cafes");
  });

  it("refuses authority changes across the actual provider await", async () => {
    const f = fixture(); f.seed(); const original = f.runtime.provider.recall.bind(f.runtime.provider);
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(f.runtime.provider, "recall").mockImplementation(async (context, request) => {
      const result = await original(context, request); entered(); await gate; return result;
    });
    const recalled = createInitiativeMemoryRecall(await f.runtime.captureRun("a"), { query: "cafes", scopes: ["global"] });
    const pending = recalled.tools.recall!.execute!({ scope: "global" }, options);
    await started;
    f.db.exec("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at='2026-09-28T00:00:00.000Z' WHERE status='active'"); release();
    expect(await pending).toMatchObject({ status: "unavailable" });
    expect(recalled.isCurrent()).toBe(false);
  });

  it("does not expose recall without provider-owned evidence or a negotiated capability", async () => {
    const f = fixture(); const captured = await f.runtime.captureRun("a");
    expect(createInitiativeMemoryRecall({ ...captured, captureRecallEvidence: undefined }, { query: "cafes", scopes: ["global"] }).tools).toEqual({});
    expect(createInitiativeMemoryRecall({ ...captured, tools: {} }, { query: "cafes", scopes: ["global"] }).tools).toEqual({});
  });

  it("does not adopt a newer Source changed after provider selection but before tool completion", async () => {
    const f = fixture(); f.seed(); const original = f.runtime.provider.recall.bind(f.runtime.provider);
    vi.spyOn(f.runtime.provider, "recall").mockImplementation(async (context, request) => {
      const result = await original(context, request);
      f.db.exec("UPDATE canonical_memory_sources SET revision=revision+1"); return result;
    });
    const recalled = createInitiativeMemoryRecall(await f.runtime.captureRun("a"), { query: "cafes", scopes: ["global"] });
    expect(await recalled.tools.recall!.execute!({ scope: "global" }, options)).toMatchObject({ status: "partial", records: [] });
  });

  it("keeps a cancelled attempted Bank spent and handles governance refusals through the same model fence", async () => {
    const f = fixture(); f.seed(); const original = f.runtime.provider.recall.bind(f.runtime.provider); const abort = new AbortController();
    vi.spyOn(f.runtime.provider, "recall").mockImplementation(async (context, request) => {
      const result = await original(context, request); abort.abort(); return result;
    });
    const recalled = createInitiativeMemoryRecall(await f.runtime.captureRun("a"), { query: "cafes", scopes: ["global"] });
    expect(await recalled.tools.recall!.execute!({ scope: "global" }, { ...options, abortSignal: abort.signal })).toMatchObject({ status: "unavailable" });
    expect(await recalled.tools.recall!.execute!({ scope: "global" }, options)).toMatchObject({ status: "allowance_used" });
    expect(await modelOutput(recalled.tools.recall!, { ok: false, code: "PERMISSION_DENIED" })).toContain("untrusted-observation");
  });

  it("closes a held recall after the real rolling-retention deletion while historical Timeline remains", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-01-02T00:00:00.000Z"));
    const f = fixture(); f.seed({ layerId: "activity", policy: { retention: { kind: "rolling-window", days: 7 } } });
    const timeline = createTimelineRepo(f.db);
    const original = timeline.append({ characterId: "a", role: "user", content: "The original cafe visit" });
    const recalled = createInitiativeMemoryRecall(await f.runtime.captureRun("a"), { query: "cafes", scopes: ["global"] });
    expect(await recalled.tools.recall!.execute!({ scope: "global" }, options)).toMatchObject({ records: [{ confirmed: true }] });
    expect(recalled.isCurrent()).toBe(true);
    now.mockReturnValue(Date.parse("2026-02-01T00:00:00.000Z"));
    expect(f.maintenance.hardDeleteRolling({ epochId: f.epochId, bankId: "global", characterId: "a", memoryId: "memory",
      expectedRevision: 1, requestId: "retention", now: "2026-02-01T00:00:00.000Z" })).toMatchObject({ outcome: "deleted" });
    expect(recalled.isCurrent()).toBe(false);
    expect(f.db.prepare("SELECT document_id FROM canonical_memory_retired_sources").get()?.document_id).toBe("document-memory");
    expect(f.db.prepare("SELECT id FROM timeline_messages WHERE id=:id").get({ id: original.id })).toBeDefined();
  });
});
