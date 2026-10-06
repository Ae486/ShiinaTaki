import { afterEach, describe, expect, it } from "vitest";
import { createHindsightActivationHarness, type HindsightActivationHarness } from "./hindsight-activation/hindsight-activation-fixture.ts";
import { createCanonicalLocalWriteFence } from "./canonical-local-write-fence.ts";
import { createCharacterImporter } from "../characters/character-import.ts";
import { createCharacterStore } from "../characters/character-store.ts";
import { strToU8, zipSync } from "fflate";
import { join } from "node:path";
import { createCanonicalIngestionSourceRepo } from "../db/canonical-ingestion-source-repo.ts";

const harnesses: HindsightActivationHarness[] = [];
afterEach(async () => { for (const harness of harnesses.splice(0)) await harness.close(); });
function harness() { const value = createHindsightActivationHarness(); harnesses.push(value); return value; }
const options = { toolCallId: "call-1", messages: [], context: undefined };

describe("canonical Local write fence", () => {
  it("cancels a transition drain without reopening writes or waiting for the timeout", async () => {
    const fence = createCanonicalLocalWriteFence(); const controller = new AbortController();
    let finish!: () => void;
    const active = fence.admit(() => new Promise<void>((resolve) => { finish = resolve; }));
    const draining = fence.quiesce({ timeoutMs: 60_000, signal: controller.signal, keepFencedOnFailure: true });
    controller.abort();
    await expect(draining).rejects.toThrow("MEMORY_OPERATION_CANCELLED");
    expect(fence.writable()).toBe(false);
    await expect(fence.admit(async () => undefined)).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    finish(); await active;
  });
  it("keeps an actually imported Character memory-unavailable while fenced and preserves its exact primary custody", async () => {
    const h = harness(); const original = h.db.prepare("SELECT * FROM canonical_memory_banks").all();
    await h.subsystem.fence.quiesce({ timeoutMs: 1000 });
    const store = createCharacterStore({ charactersDir: join(h.dataDir, "characters") });
    const archiveBase64 = Buffer.from(zipSync({
      "casual/model.json": strToU8(JSON.stringify({ model: "data/model.moc", textures: ["data/t.png"] })),
      "casual/data/model.moc": strToU8("fixture"), "casual/data/t.png": strToU8("fixture"),
    })).toString("base64");
    const imported = await createCharacterImporter({ store }).import({ sourceKind: "folder-archive", archiveBase64, fileName: "New-Character.zip" });
    const run = await h.subsystem.captureRun(imported.characterId);
    expect(run.snapshot).toMatchObject({ providerId: "local", authorityEpochId: h.local.epochId,
      capabilities: { retain: false, recall: false, edit: false } });
    expect(Object.keys(run.tools)).toEqual([]); expect(run.assemble!("hello")).toEqual(expect.any(String));
    expect(() => h.subsystem.engine.assemble({ characterId: imported.characterId, currentMessage: "hello" })).toThrow("MEMORY_AUTHORITY_FENCED");
    expect(h.db.prepare("SELECT * FROM canonical_memory_banks").all()).toEqual(original);
    const session = h.custody.begin({ characterId: imported.characterId, repo: h.timeline });
    const entry = session.repo.append({ characterId: imported.characterId, role: "user", content: "A late primary source" });
    session.finalize();
    expect(createCanonicalIngestionSourceRepo(h.db).pendingEntries({ epochId: h.local.epochId,
      characterId: imported.characterId, throughSeq: entry.seq }).map((item) => item.entry.id)).toEqual([entry.id]);
    h.subsystem.fence.retire();
    await expect(h.subsystem.captureRun(imported.characterId)).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
  });
  it("counts detached admitted children and rejects unadmitted continuations of a completed owner", async () => {
    const fence = createCanonicalLocalWriteFence();
    let release!: () => void; let detached!: Promise<void>; let late!: () => Promise<unknown>;
    await fence.admit(() => {
      detached = fence.admit(() => new Promise<void>((resolve) => { release = resolve; }));
      const gate = new Promise<void>((resolve) => { late = async () => { resolve(); }; });
      const continuation = gate.then(() => fence.admit(() => "stale"));
      const trigger = late; late = async () => { await trigger(); return continuation; };
    });
    let drained = false; const wait = fence.quiesce({ timeoutMs: 1000 }).then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false);
    await expect(late()).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    release(); await detached; await wait; expect(drained).toBe(true);
  });
  it("drains admitted writers before fencing, refuses later writes, and reopens only through release until retired", async () => {
    const fence = createCanonicalLocalWriteFence();
    let finish!: () => void; const slow = fence.admit(() => new Promise<void>((resolve) => { finish = resolve; }));
    let quiesced = false; const quiesce = fence.quiesce({ timeoutMs: 1_000 }).then(() => { quiesced = true; });
    await Promise.resolve(); expect(quiesced).toBe(false); expect(fence.writable()).toBe(false);
    await expect(fence.admit(async () => "late")).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    finish(); await slow; await quiesce; expect(quiesced).toBe(true);
    await expect(fence.quiesce({ timeoutMs: 10 })).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    fence.release(); expect(fence.writable()).toBe(true); expect(fence.admitSync(() => "again")).toBe("again");
    const stuck = fence.admit(() => new Promise<void>(() => undefined));
    await expect(fence.quiesce({ timeoutMs: 5 })).rejects.toThrow("MEMORY_QUIESCENCE_TIMEOUT");
    expect(fence.writable()).toBe(true); void stuck;
    fence.retire(); fence.release(); expect(fence.writable()).toBe(false);
    expect(() => fence.admitSync(() => "never")).toThrow("MEMORY_AUTHORITY_FENCED");
  });

  it("returns structured MEMORY_AUTHORITY_FENCED from every Local writer while reads and witnesses stay open", async () => {
    const h = harness(); const { subsystem } = h;
    const run = await subsystem.captureRun("taki");
    await subsystem.fence.quiesce({ timeoutMs: 1_000 });
    expect(() => subsystem.engine.writeEntry({ characterId: "taki", type: "episodes", content: "fenced", importance: 3 })).toThrow("MEMORY_AUTHORITY_FENCED");
    expect(() => subsystem.writeMemory({ characterId: "taki", layer: "episodes", content: "fenced", importance: 3 })).toThrow("MEMORY_AUTHORITY_FENCED");
    await expect(subsystem.tidy.runNow("taki")).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    await expect(subsystem.maintenance.run("taki", "primary")).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
    expect(await subsystem.memoryFlush.prepareRetirement({ characterId: "taki", fromSeq: 0, throughSeq: 2, operationId: "flush-1" }))
      .toEqual({ status: "retryable_failure", code: "MEMORY_AUTHORITY_FENCED" });
    const retained = await run.tools.retain!.execute!({ content: "我记得这件事。", layer: "episodes", context: null }, options);
    expect(retained).toMatchObject({ ok: false, code: "MEMORY_AUTHORITY_FENCED" });
    const recalled = await run.tools.recall!.execute!({ query: "这件事", scope: "both", limit: 4, maxTokens: 400 }, options);
    expect(recalled).toMatchObject({ ok: true });
    expect(subsystem.engine.assemble({ characterId: "taki", currentMessage: "hello" })).toEqual(expect.any(String));
    const late = await subsystem.captureRun("taki");
    expect(await late.tools.update_memory!.execute!({ scope: "global", memoryId: "missing", expectedRevision: 1, patch: { text: "x" } }, options))
      .toMatchObject({ ok: false, code: "MEMORY_AUTHORITY_FENCED" });
    const entries = h.primary();
    expect(h.db.prepare("SELECT count(*) AS n FROM canonical_memory_primary_commits").get()?.n).toBe(entries.length);
    subsystem.fence.release();
    expect(await run.tools.retain!.execute!({ content: "我记得这件事。", layer: "episodes", context: null }, options)).toMatchObject({ ok: true });
  });
});
