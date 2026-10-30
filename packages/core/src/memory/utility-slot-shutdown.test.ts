import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/sqlite.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { generatingModel } from "../testing/mock-language-model.ts";
import { createUtilitySlot } from "./utility-slot.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function tick() { return new Promise<void>((resolve) => setImmediate(resolve)); }
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: [] }); db.exec("CREATE TABLE effects(id TEXT PRIMARY KEY)");
  const { logger, records } = createCaptureLogger(); const slot = createUtilitySlot({ logger, mainModel: generatingModel("unused") });
  cleanup.push(async () => { await slot.stop(); db.close(); }); return { db, slot, records };
}

describe("shared Utility Slot shutdown", () => {
  it("waits for the active real effect, drops queued callbacks and refuses new work before SQLite closes", async () => {
    const f = fixture(); const entered = deferred(); const release = deferred(); cleanup.push(release.resolve);
    const active = f.slot.run("active-owner", async () => { entered.resolve(); await release.promise;
      f.db.prepare("INSERT INTO effects VALUES ('active')").run(); return { usage: { inputTokens: 7, outputTokens: 3 } }; });
    await entered.promise; const queued = vi.fn(async () => { f.db.prepare("INSERT INTO effects VALUES ('queued')").run(); });
    const waiting = f.slot.run("queued-owner", queued); let stopped = false;
    const stopping = f.slot.stop().then(() => { stopped = true; }); await tick(); expect(stopped).toBe(false);
    expect(await f.slot.run("after-stop", queued)).toBeUndefined(); release.resolve(); await stopping;
    expect(await active).toMatchObject({ usage: { inputTokens: 7, outputTokens: 3 } }); expect(await waiting).toBeUndefined();
    expect(queued).not.toHaveBeenCalled(); expect(f.db.prepare("SELECT * FROM effects").all()).toEqual([{ id: "active" }]);
    expect(f.slot.usage()).toEqual({ calls: 1, inputTokens: 7, outputTokens: 3, usageUnknown: 0 });
    f.db.close(); const prepare = vi.spyOn(f.db, "prepare"); await f.slot.stop(); await tick(); expect(prepare).not.toHaveBeenCalled();
  });

  it("drains new work appended while settling without sealing the shared slot", async () => {
    const f = fixture(); const first = deferred(); const second = deferred(); cleanup.push(first.resolve, second.resolve);
    let nested: Promise<unknown> | undefined;
    const running = f.slot.run("first-owner", async () => { await first.promise;
      nested = f.slot.run("second-owner", async () => { await second.promise; f.db.prepare("INSERT INTO effects VALUES ('second')").run(); }); });
    let settled = false; const draining = f.slot.settle().then(() => { settled = true; });
    first.resolve(); await running; await tick(); expect(settled).toBe(false); second.resolve(); await draining; await nested;
    expect(f.db.prepare("SELECT * FROM effects").all()).toEqual([{ id: "second" }]);
    expect(await f.slot.run("later-owner", async () => "still-open")).toBe("still-open");
  });

  it("settles a failed active task with truthful unknown usage and bounded diagnostics", async () => {
    const f = fixture(); const release = deferred(); const entered = deferred(); cleanup.push(release.resolve);
    const active = f.slot.run("controlled-owner", async () => { entered.resolve(); await release.promise; throw new Error("PRIVATE_MODEL_PAYLOAD"); });
    await entered.promise; const stopping = f.slot.stop(); release.resolve(); await stopping; expect(await active).toBeUndefined();
    expect(f.slot.usage()).toEqual({ calls: 1, inputTokens: 0, outputTokens: 0, usageUnknown: 1 });
    expect(JSON.stringify(f.records)).not.toContain("PRIVATE_MODEL_PAYLOAD");
  });
});
