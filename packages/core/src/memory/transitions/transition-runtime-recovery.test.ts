import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransitionPublicationFixture } from "../../testing/memory-transition-publication-fixtures.ts";
import { commitTransitionStage, completeTransitionStage, reenterTransitionStage, type TransitionStageFixture } from "../../testing/memory-transition-cycle-fixtures.ts";
import { transitionOutcomeFixture } from "../../testing/memory-transition-outcome-fixtures.ts";
import { hindsightFixtureSecrets } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import type { HindsightActivationHarness } from "../hindsight-activation/hindsight-activation-fixture.ts";
import { createConfigSource } from "../../config/config-source.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { failingGenerateModel } from "../../testing/mock-language-model.ts";
import { createSummaryRepo } from "../../db/summary-repo.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { composeMemoryRuntime } from "../runtime-composition.ts";
import { createHindsightClient } from "../hindsight/hindsight-client.ts";
import * as hindsightModule from "../hindsight/hindsight-memory-subsystem.ts";

function runtimeFor(h: Pick<HindsightActivationHarness, "db" | "dataDir" | "timeline">) {
  const source = createConfigSource({ repo: createConfigRepo(h.db), env: { TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18481" } });
  const { logger } = createCaptureLogger(); const secrets = hindsightFixtureSecrets().catalog;
  const client = createHindsightClient({ endpoint: "http://127.0.0.1:18481", resolveApiKey: () => "fixture-key",
    transport: async () => { throw new Error("owned fixture remains offline"); } });
  return composeMemoryRuntime({ db: h.db, dataDir: h.dataDir, promptDir: join(h.dataDir, "prompt"),
    bootId: "recovery", model: failingGenerateModel(new Error("no model calls")), timeline: h.timeline,
    summaries: createSummaryRepo(h.db), windowStart: () => 1, estimatedTokens: () => 0, budget: () => 100_000,
    compact: { triggerRatio: 0.8, keepMessages: 3 }, env: {}, logger, hindsight: { source, secrets, client } });
}

afterEach(() => vi.restoreAllMocks());
describe("transition source boot and shutdown recovery", () => {
  it.each(["hindsight", "local"] as const)("keeps an unresolved %s source unavailable on boot and reconstructs only after positive abort", async (provider) => {
    let runtime!: ReturnType<typeof runtimeFor>;
    const f = await createTransitionPublicationFixture({ beforeAdmission: async (h) => { runtime = runtimeFor(h); runtime.start(); } });
    try {
      let stage: TransitionStageFixture = f;
      if (provider === "local") {
        await runtime.transitions.quiesce({ ...f.input, timeoutMs: 1000 });
        const receipt = commitTransitionStage(f); await runtime.transitions.bind(f.intent.transitionId);
        completeTransitionStage(f, receipt); stage = reenterTransitionStage(f, receipt);
      }
      await runtime.stop(); runtime = runtimeFor(f); runtime.start();
      const snapshot = () => provider === "local" ? runtime.bindingSnapshot() : runtime.hindsightBindingSnapshot();
      expect(snapshot().binding.kind).toBe("unavailable");
      const marker = readMemoryAuthoritySelection(f.db);
      await expect(runtime.transitions.resumeSource(stage.intent.operationId)).rejects.toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      for (const evidence of stage.proofs) runtime.transitions.nativeOutcome({ ...stage.input,
        status: transitionOutcomeFixture(evidence.status, null) });
      const resolution = runtime.transitions.abort(stage.input);
      expect(resolution.result.authorityCommitted).toBe(false);
      await runtime.transitions.resumeSource(stage.intent.operationId);
      expect(snapshot().binding).toEqual({ kind: "published", epochId: marker.epochId });
      expect(readMemoryAuthoritySelection(f.db)).toEqual(marker);
      expect(f.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(provider === "local" ? 1 : 0);
    } finally { await runtime.stop(); await f.close(); }
  }, 20_000);

  it("cancels active transition drain on stop and permanently fences held source work", async () => {
    let runtime!: ReturnType<typeof runtimeFor>; let source!: ReturnType<typeof hindsightModule.createHindsightMemorySubsystem>;
    const create = hindsightModule.createHindsightMemorySubsystem;
    vi.spyOn(hindsightModule, "createHindsightMemorySubsystem").mockImplementation((input) => { source = create(input); return source; });
    const f = await createTransitionPublicationFixture({ beforeAdmission: async (h) => { runtime = runtimeFor(h); runtime.start(); } });
    let release!: () => void;
    const held = source.workFence.admit(() => new Promise<void>((resolve) => { release = resolve; }));
    try {
      const drain = runtime.transitions.quiesce({ ...f.input, timeoutMs: 60_000 });
      const cancelled = expect(drain).rejects.toThrow("MEMORY_OPERATION_CANCELLED");
      await vi.waitFor(() => expect(source.workFence.writable()).toBe(false));
      await runtime.transitions.stop(); await cancelled;
      expect(() => source.workFence.admitSync(() => undefined)).toThrow();
      expect(() => source.writeFence.admitSync(() => undefined)).toThrow();
      expect(f.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(0);
    } finally { release(); await held; await runtime.stop(); await f.close(); }
  });
});
