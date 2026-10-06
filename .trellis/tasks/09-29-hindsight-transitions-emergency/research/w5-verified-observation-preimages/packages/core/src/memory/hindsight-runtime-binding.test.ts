import { describe, expect, it, vi } from "vitest";
import { createHindsightRuntimeBinding, type HindsightSubsystem } from "./hindsight-runtime-binding.ts";
import { createCanonicalLocalWriteFence } from "./canonical-local-write-fence.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { openDatabase } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";

describe("Hindsight runtime epoch disposal", () => {
  it("retires failed and replaced drafts permanently and awaits all disposal before Core stop", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); const { logger } = createCaptureLogger();
    const releases: Array<() => void> = []; const drafts: HindsightSubsystem[] = [];
    const binding = createHindsightRuntimeBinding({ db, logger, construct: () => {
      const draft = { engine: {}, maintenance: {}, memoryFlush: { prepareRetirement: vi.fn() }, tidy: {},
        writeMemory: vi.fn(), captureRun: vi.fn(), recordPrimaryCommitted: vi.fn(), state: {}, scheduler: {},
        writeFence: createCanonicalLocalWriteFence(), workFence: createCanonicalLocalWriteFence(),
        start: () => { if (drafts.length === 1) throw new Error("owned failed start"); },
        stop: () => new Promise<void>((resolve) => releases.push(resolve)) } as unknown as HindsightSubsystem;
      drafts.push(draft); return draft;
    } });
    try {
      binding.publish("same-epoch"); expect(() => binding.start()).toThrow("owned failed start");
      binding.publish("same-epoch"); binding.start();
      const replacement = binding.replace("same-epoch"); binding.start();
      let stopped = false; const shutdown = binding.stop().then(() => { stopped = true; });
      await Promise.resolve(); expect(stopped).toBe(false); expect(releases).toHaveLength(3);
      for (const draft of drafts) expect(() => draft.workFence.admitSync(() => undefined)).toThrow("MEMORY_AUTHORITY_FENCED");
      releases[1]!(); releases[2]!(); await Promise.resolve(); expect(stopped).toBe(false);
      releases[0]!(); await shutdown; await replacement.retired;
      expect(stopped).toBe(true); expect(() => binding.publish("later-epoch")).toThrow("MEMORY_OPERATION_CANCELLED");
    } finally { db.close(); }
  });
});
