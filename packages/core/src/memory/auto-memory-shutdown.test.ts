import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/sqlite.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createMaintenanceAutoMemory } from "./auto-memory.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function tick() { return new Promise<void>((resolve) => setImmediate(resolve)); }

describe("automatic maintenance shutdown", () => {
  it("stops only after both active branches settle and drops queued work on both chains", async () => {
    const enteredMaintenance = deferred(); const enteredCompact = deferred();
    const releaseMaintenance = deferred(); const releaseCompact = deferred();
    const { logger } = createCaptureLogger();
    const maintenance = vi.fn(async () => { enteredMaintenance.resolve(); await releaseMaintenance.promise; });
    const compact = vi.fn(async () => { enteredCompact.resolve(); await releaseCompact.promise; });
    const auto = createMaintenanceAutoMemory({ maintenance: () => ({ run: maintenance }), compact: { maybeRun: compact }, logger });
    cleanup.push(auto.stop, releaseMaintenance.resolve, releaseCompact.resolve);
    const active = auto.onTurnCompleted("taki");
    await Promise.all([enteredMaintenance.promise, enteredCompact.promise]);
    const queued = auto.onTurnCompleted("taki");
    let stopped = false;
    const stopping = auto.stop().then(() => { stopped = true; });
    releaseMaintenance.resolve(); await tick();
    expect(stopped).toBe(false);
    releaseCompact.resolve();
    await stopping; await Promise.all([active, queued]);
    expect(maintenance).toHaveBeenCalledTimes(1);
    expect(compact).toHaveBeenCalledTimes(1);
  });

  it("serializes each Character within each branch while allowing other Characters to progress", async () => {
    const maintenanceRelease = deferred(); const compactRelease = deferred(); const { logger } = createCaptureLogger();
    const maintenanceCalls: string[] = []; const compactCalls: string[] = [];
    const auto = createMaintenanceAutoMemory({
      maintenance: () => ({ run: async (id) => { maintenanceCalls.push(id); if (id === "taki") await maintenanceRelease.promise; } }),
      compact: { maybeRun: async (id) => { compactCalls.push(id); if (id === "taki") await compactRelease.promise; } },
      logger,
    });
    cleanup.push(auto.stop, maintenanceRelease.resolve, compactRelease.resolve);
    const active = auto.onTurnCompleted("taki");
    const queued = auto.onTurnCompleted("taki");
    await auto.onTurnCompleted("yui");
    expect(maintenanceCalls).toEqual(["taki", "yui"]);
    expect(compactCalls).toEqual(["taki", "yui"]);
    maintenanceRelease.resolve(); await tick(); await tick();
    expect(maintenanceCalls).toEqual(["taki", "yui", "taki"]);
    expect(compactCalls).toEqual(["taki", "yui"]);
    compactRelease.resolve(); await Promise.all([active, queued]);
    expect(compactCalls).toEqual(["taki", "yui", "taki"]);
  });

  it("captures Legacy ordering at trigger admission even if the selection changes before dispatch", async () => {
    const release = deferred(); const entered = deferred(); const { logger } = createCaptureLogger();
    let legacy = true;
    const compact = vi.fn(async () => undefined);
    const auto = createMaintenanceAutoMemory({
      maintenance: () => ({ run: async () => { entered.resolve(); await release.promise; } }),
      compact: { maybeRun: compact }, legacyMaintenanceBeforeCompact: () => legacy, logger,
    });
    cleanup.push(auto.stop, release.resolve);
    const active = auto.onTurnCompleted("taki");
    legacy = false;
    await entered.promise; await tick();
    expect(compact).not.toHaveBeenCalled();
    release.resolve(); await active;
    expect(compact).toHaveBeenCalledTimes(1);
  });

  it("admits compaction while provider maintenance is blocked", async () => {
    const entered = deferred(); const release = deferred(); const { logger } = createCaptureLogger();
    const maintenance = vi.fn(async () => { entered.resolve(); await release.promise; });
    const compact = vi.fn(async () => undefined);
    const auto = createMaintenanceAutoMemory({ maintenance: () => ({ run: maintenance }), compact: { maybeRun: compact }, logger });
    cleanup.push(auto.stop, release.resolve);
    const active = auto.onTurnCompleted("taki");
    await entered.promise; await tick();
    expect(compact).toHaveBeenCalledTimes(1);
    release.resolve(); await active;
  });

  it("drops not-yet-started macrotasks without calling maintenance or Compaction", async () => {
    const maintenance = vi.fn(async () => undefined); const compact = vi.fn(async () => undefined); const { logger } = createCaptureLogger();
    const auto = createMaintenanceAutoMemory({ maintenance: () => ({ run: maintenance }), compact: { maybeRun: compact }, logger });
    cleanup.push(auto.stop); const queued = auto.onTurnCompleted("taki"); await auto.stop(); await queued;
    await auto.onTurnCompleted("other"); expect(maintenance).not.toHaveBeenCalled(); expect(compact).not.toHaveBeenCalled();
  });

  it("Legacy waits for active maintenance, skips its later Compaction and drops queued same-Character work", async () => {
    const db = openDatabase({ path: ":memory:", migrations: [] }); db.exec("CREATE TABLE effects(id TEXT PRIMARY KEY)");
    cleanup.push(() => db.close()); const entered = deferred(); const release = deferred(); const { logger } = createCaptureLogger();
    const maintenance = vi.fn(async () => { entered.resolve(); await release.promise; db.prepare("INSERT INTO effects VALUES ('committed')").run(); });
    const compact = vi.fn(async () => { db.prepare("INSERT INTO effects VALUES ('compact')").run(); });
    const auto = createMaintenanceAutoMemory({ maintenance: () => ({ run: maintenance }), compact: { maybeRun: compact },
      legacyMaintenanceBeforeCompact: () => true, logger });
    cleanup.push(auto.stop, release.resolve); const active = auto.onTurnCompleted("taki"); await entered.promise;
    const queued = auto.onTurnCompleted("taki"); let stopped = false; const stopping = auto.stop().then(() => { stopped = true; });
    await tick(); expect(stopped).toBe(false); release.resolve(); await stopping; await Promise.all([active, queued]);
    expect(maintenance).toHaveBeenCalledTimes(1); expect(compact).not.toHaveBeenCalled();
    expect(db.prepare("SELECT * FROM effects").all()).toEqual([{ id: "committed" }]); db.close(); const prepare = vi.spyOn(db, "prepare");
    await auto.onTurnCompleted("taki"); await auto.stop(); await tick(); expect(prepare).not.toHaveBeenCalled();
  });

  it("Legacy settle preserves the maintenance-to-Compaction order and accepts later turns", async () => {
    const entered = deferred(); const release = deferred(); const { logger } = createCaptureLogger(); const order: string[] = [];
    const auto = createMaintenanceAutoMemory({ maintenance: () => ({ run: async () => {
      order.push("maintenance"); entered.resolve(); await release.promise; } }),
    compact: { maybeRun: async () => { order.push("compact"); } }, legacyMaintenanceBeforeCompact: () => true, logger });
    cleanup.push(auto.stop, release.resolve); const active = auto.onTurnCompleted("taki"); await entered.promise;
    let settled = false; const draining = auto.settle().then(() => { settled = true; }); await tick(); expect(settled).toBe(false);
    release.resolve(); await draining; await active; expect(order).toEqual(["maintenance", "compact"]);
    await auto.onTurnCompleted("taki"); expect(order).toEqual(["maintenance", "compact", "maintenance", "compact"]);
  });
});
