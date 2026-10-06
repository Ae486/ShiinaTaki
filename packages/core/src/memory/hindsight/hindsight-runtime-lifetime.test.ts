import { describe, expect, it, vi } from "vitest";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";

describe("started Hindsight owners at drain and shutdown", () => {
  it("owns both Banks after the caller's admission budget expires during a transition drain", async () => {
    const f = hindsightRuntimeFixture(); const subsystem = f.subsystem();
    let releaseGlobal = () => {}; let releaseCharacter = () => {};
    try {
      await subsystem.captureRun("taki"); subsystem.start();
      await subsystem.scheduler.pause();
      f.config.upsert("TAKI_CHAT_ACK_TIMEOUT_MS", 100);
      const global = new Promise<void>((resolve) => { releaseGlobal = resolve; });
      const character = new Promise<void>((resolve) => { releaseCharacter = resolve; });
      const entered: string[] = [];
      f.remote.control.beforeChanges = async (bankId) => {
        entered.push(bankId);
        await (bankId === f.banks[0]!.scope.bankId ? global : character);
      };
      const run = await subsystem.captureRun("taki");
      expect(Object.keys(run.tools)).toContain("recall");
      expect(entered).toEqual([f.banks[0]!.scope.bankId]);
      let drained = false;
      const draining = subsystem.workFence.quiesce({ timeoutMs: 5000 }).then(() => { drained = true; });
      releaseGlobal();
      await vi.waitFor(() => expect(entered).toEqual(f.banks.map((bank) => bank.scope.bankId)));
      expect(drained).toBe(false);
      releaseCharacter(); await draining;
      expect(drained).toBe(true);
      expect(f.logs.filter((log) => typeof log.obj === "object" && log.obj !== null
        && "outcome" in log.obj && log.obj.outcome === "background_failed")).toEqual([]);
    } finally { releaseGlobal(); releaseCharacter(); await f.close(); }
  });

  it("waits for an admitted foreground sync while refusing manual work behind the transition fence", async () => {
    const f = hindsightRuntimeFixture(); const subsystem = f.subsystem();
    try {
      await subsystem.captureRun("taki"); subsystem.start();
      let release!: () => void; let started!: () => void;
      const entered = new Promise<void>((resolve) => { started = resolve; });
      const held = new Promise<void>((resolve) => { release = resolve; });
      f.remote.control.beforeChanges = async () => { started(); await held; };
      const capture = subsystem.captureRun("taki"); await entered;
      let drained = false;
      const draining = Promise.all([subsystem.writeFence.quiesce({ timeoutMs: 1000 }),
        subsystem.workFence.quiesce({ timeoutMs: 1000 }), subsystem.scheduler.pause()]).then(() => { drained = true; });
      await Promise.resolve(); expect(drained).toBe(false);
      expect(() => subsystem.scheduler.requestManual(f.banks[0]!.scope.bankId, "incremental")).toThrow("MEMORY_AUTHORITY_FENCED");
      release(); await capture; await draining; expect(drained).toBe(true);
      await subsystem.stop();
      await expect(subsystem.captureRun("taki")).rejects.toThrow();
    } finally { await f.close(); }
  });

  it("settles actual foreground synchronization before closing a stopped subsystem", async () => {
    const f = hindsightRuntimeFixture(); const subsystem = f.subsystem();
    try {
      await subsystem.captureRun("taki"); subsystem.start();
      let release!: () => void; let started!: () => void;
      const entered = new Promise<void>((resolve) => { started = resolve; });
      const held = new Promise<void>((resolve) => { release = resolve; });
      f.remote.control.beforeChanges = async () => { started(); await held; };
      const capture = subsystem.captureRun("taki").catch(() => undefined); await entered;
      let stopped = false; const shutdown = subsystem.stop().then(() => { stopped = true; });
      await Promise.resolve(); expect(stopped).toBe(false);
      release(); await capture; await shutdown; expect(stopped).toBe(true);
      expect(() => subsystem.workFence.admitSync(() => undefined)).toThrow("MEMORY_AUTHORITY_FENCED");
    } finally { await f.close(); }
  });
});
