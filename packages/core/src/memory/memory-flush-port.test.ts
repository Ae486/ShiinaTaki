import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryAutoRepo } from "../db/memory-auto-repo.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import type { FlushWriter } from "./flush-writer.ts";
import { createMemoryAuthorityFence } from "./legacy-migration/memory-authority-fence.ts";
import {
  canonicalLocalMemoryFlushPort,
  createLegacyMemoryFlushPort,
  unavailableHindsightMemoryFlushPort,
} from "./memory-flush-port.ts";

const fixtures: CompanionFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

function legacyFixture(writer: FlushWriter) {
  const fixture = createCompanionFixture();
  fixtures.push(fixture);
  const timeline = createTimelineRepo(fixture.db);
  const autoState = createMemoryAutoRepo(fixture.db);
  for (let seq = 1; seq <= 4; seq += 1) {
    timeline.append({ characterId: "taki", role: "user", content: `m${seq}` });
  }
  return { autoState, port: createLegacyMemoryFlushPort({ timeline, autoState, writer }) };
}

const request = {
  characterId: "taki",
  fromSeq: 1,
  throughSeq: 3,
  operationId: "compact:taki:1:3",
};

describe("MemoryFlushPort", () => {
  it("reuses the Legacy watermark so the same operation/range flushes once", async () => {
    const run = vi.fn(async () => ({ writes: 2 }));
    const fixture = legacyFixture({ run });

    await expect(fixture.port.prepareRetirement(request)).resolves.toEqual({
      status: "success",
      writes: 2,
      throughSeq: 3,
    });
    await expect(fixture.port.prepareRetirement(request)).resolves.toEqual({
      status: "success",
      writes: 0,
      throughSeq: 3,
    });

    expect(run).toHaveBeenCalledOnce();
    expect(fixture.autoState.get("taki").lastFlushSeq).toBe(3);
  });

  it("returns a bounded retryable outcome and preserves the watermark on Legacy failure", async () => {
    const fixture = legacyFixture({ run: async () => { throw new Error("provider detail must stay bounded"); } });

    await expect(fixture.port.prepareRetirement(request)).resolves.toEqual({
      status: "retryable_failure",
      code: "LEGACY_FLUSH_FAILED",
    });
    expect(fixture.autoState.get("taki").lastFlushSeq).toBe(0);
  });

  it("refuses an unconfigured canonical flush and unavailable Hindsight explicitly", async () => {
    await expect(canonicalLocalMemoryFlushPort().prepareRetirement(request)).resolves.toEqual({
      status: "retryable_failure",
      code: "MEMORY_FLUSH_INCOMPLETE",
    });
    await expect(unavailableHindsightMemoryFlushPort().prepareRetirement(request)).resolves.toEqual({
      status: "permanent_unavailable",
      code: "HINDSIGHT_RUNTIME_UNAVAILABLE",
    });
  });

  it("holds the authority fence for the full Legacy flush before activation can retire it", async () => {
    let release: (() => void) | undefined;
    let markWriterStarted: (() => void) | undefined;
    const writerStarted = new Promise<void>((resolve) => { markWriterStarted = resolve; });
    const writerRelease = new Promise<void>((resolve) => { release = resolve; });
    const fence = createMemoryAuthorityFence();
    const fixture = createCompanionFixture();
    fixtures.push(fixture);
    const timeline = createTimelineRepo(fixture.db);
    const autoState = createMemoryAutoRepo(fixture.db);
    timeline.append({ characterId: "taki", role: "user", content: "m1" });
    const port = createLegacyMemoryFlushPort({
      timeline,
      autoState,
      fence,
      writer: {
        async run() {
          markWriterStarted?.();
          await writerRelease;
          return { writes: 0 };
        },
      },
    });

    const flushing = port.prepareRetirement({ ...request, throughSeq: 1 });
    await writerStarted;
    let activated = false;
    const activation = fence.quiesce({ timeoutMs: 1_000, retireOnSuccess: true }, async () => {
      activated = true;
    });
    await Promise.resolve();
    expect(activated).toBe(false);

    release?.();
    await expect(flushing).resolves.toMatchObject({ status: "success", throughSeq: 1 });
    await activation;
    expect(activated).toBe(true);
    await expect(port.prepareRetirement({ ...request, throughSeq: 2 })).resolves.toEqual({
      status: "retryable_failure",
      code: "MEMORY_AUTHORITY_FENCED",
    });
  });
});
