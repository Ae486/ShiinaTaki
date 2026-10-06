import { describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createLocalRuntimeBinding, type LocalSubsystem } from "./local-runtime-binding.ts";

function draft(overrides: Partial<Record<keyof LocalSubsystem, unknown>> = {}): LocalSubsystem {
  return { engine: {}, maintenance: { run: vi.fn() }, memoryFlush: { prepareRetirement: vi.fn() }, tidy: {}, writeMemory: vi.fn(),
    captureRun: vi.fn(), recordPrimaryCommitted: vi.fn(), start: vi.fn(), stop: vi.fn(), ...overrides } as unknown as LocalSubsystem;
}

function binding(construct: (epochId: string) => LocalSubsystem) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const { logger, records } = createCaptureLogger();
  return { db, records, binding: createLocalRuntimeBinding({ db, construct, logger }) };
}

describe("one published Local runtime binding", () => {
  it("settles a failed draft's asynchronous shutdown even after a repaired draft was retired", async () => {
    let release!: () => void;
    const failed = draft({ start: () => { throw new Error("start failed"); },
      stop: () => new Promise<void>((resolve) => { release = resolve; }) });
    const f = binding(vi.fn().mockReturnValueOnce(failed).mockReturnValue(draft()));
    try {
      expect(() => f.binding.publish("same-epoch")).toThrow("start failed");
      f.binding.publish("same-epoch"); f.binding.retire();
      let stopped = false; const stopping = f.binding.stop().then(() => { stopped = true; });
      await Promise.resolve(); expect(stopped).toBe(false);
      release(); await stopping; expect(stopped).toBe(true);
      expect(() => f.binding.publish("same-epoch")).toThrow("MEMORY_OPERATION_CANCELLED");
    } finally { f.db.close(); }
  });
  it("publishes a complete draft, starts it after publication and reports a pure snapshot", () => {
    const value = draft();
    const f = binding(() => value);
    expect(f.binding.snapshot()).toMatchObject({ selection: "legacy-markdown", binding: { kind: "none" }, lifetime: "running", flush: "failing" });
    expect(f.binding.publish("epoch-1")).toBe(value);
    expect(value.start).toHaveBeenCalledOnce();
    expect(f.binding.current()).toBe(value);
    const publication = f.binding.publicationState();
    publication.binding = { kind: "none" };
    expect(f.binding.publicationState().binding).toEqual({ kind: "published", epochId: "epoch-1" });
    expect(f.binding.publicationState().revision).toBe(publication.revision);
    expect(f.binding.snapshot()).toMatchObject({ binding: { kind: "published", epochId: "epoch-1" }, flush: "available" });
    expect(value.captureRun).not.toHaveBeenCalled();
    expect(() => f.binding.publish("epoch-1")).toThrow("MEMORY_INTEGRITY_ERROR");
    f.binding.stop();
    expect(f.binding.publicationState().revision).toBeGreaterThan(publication.revision);
    expect(value.stop).toHaveBeenCalledOnce();
    expect(f.binding.snapshot()).toMatchObject({ lifetime: "stopped", flush: "failing" });
    f.db.close();
  });

  it.each([
    { name: "constructor failure", construct: () => { throw new Error("MEMORY_AUTHORITY_MISMATCH"); }, code: "MEMORY_AUTHORITY_MISMATCH" },
    { name: "flush accessor failure", construct: () => draft({ get memoryFlush() { throw new Error("flush accessor exploded"); } }), code: "MEMORY_LOCAL_BINDING_FAILED" },
    { name: "incomplete surface", construct: () => draft({ maintenance: undefined }), code: "MEMORY_INTEGRITY_ERROR" },
    { name: "start failure", construct: () => draft({ start: () => { throw new Error("sweeper failed"); } }), code: "MEMORY_LOCAL_BINDING_FAILED", stops: 1 },
  ])("disposes the draft and stays unavailable on $name", ({ construct, code, stops }) => {
    let built: LocalSubsystem | undefined; let next: () => LocalSubsystem = construct;
    const f = binding(() => { built = next(); return built; });
    expect(() => f.binding.publish("epoch-1")).toThrow();
    expect(f.binding.current()).toBeUndefined();
    expect(f.binding.snapshot()).toMatchObject({ binding: { kind: "unavailable", epochId: "epoch-1", code }, flush: "failing" });
    if (stops !== undefined) expect(built?.stop).toHaveBeenCalledTimes(stops);
    expect(f.records.some((record) => record.level === "error" && (record.obj as { code: string }).code === "MEMORY_LOCAL_BINDING_UNAVAILABLE")).toBe(true);
    // Same-epoch recovery may publish again after a failed attempt; a failed draft never leaks between attempts.
    next = () => draft();
    expect(f.binding.publish("epoch-1")).toBe(built);
    expect(f.binding.snapshot()).toMatchObject({ binding: { kind: "published", epochId: "epoch-1" }, flush: "available" });
    f.db.close();
  });
});
