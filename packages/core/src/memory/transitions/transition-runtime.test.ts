import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransitionPublicationFixture } from "../../testing/memory-transition-publication-fixtures.ts";
import { commitTransitionStage, completeTransitionStage, reenterTransitionStage, returnTransitionStage, type TransitionStageFixture } from "../../testing/memory-transition-cycle-fixtures.ts";
import { transitionOutcomeFixture } from "../../testing/memory-transition-outcome-fixtures.ts";
import { hindsightFixtureSecrets } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { createConfigSource } from "../../config/config-source.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { failingGenerateModel } from "../../testing/mock-language-model.ts";
import { createSummaryRepo } from "../../db/summary-repo.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { recordTransitionNativeOutcome } from "../../db/memory-transition-native-outcome.ts";
import { composeMemoryRuntime } from "../runtime-composition.ts";
import { createHindsightClient } from "../hindsight/hindsight-client.ts";
import * as localModule from "../canonical-local-subsystem.ts";
import * as hindsightModule from "../hindsight/hindsight-memory-subsystem.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";

afterEach(() => vi.restoreAllMocks());
describe("production transition runtime composition", () => {
  it("executes two provider cycles with real receipts, repairs failed binding and gates native activation", async () => {
    let runtime!: ReturnType<typeof composeMemoryRuntime>;
    const locals: ReturnType<typeof localModule.createCanonicalLocalSubsystem>[] = [];
    const hindsights: ReturnType<typeof hindsightModule.createHindsightMemorySubsystem>[] = [];
    const localConstructor = localModule.createCanonicalLocalSubsystem;
    const nativeConstructor = hindsightModule.createHindsightMemorySubsystem;
    const f = await createTransitionPublicationFixture({ beforeAdmission: async (h) => {
    vi.spyOn(localModule, "createCanonicalLocalSubsystem").mockImplementation((input) => {
      const value = localConstructor(input); locals.push(value);
      if (locals.length === 1) vi.spyOn(value, "start").mockImplementationOnce(() => { throw new Error("owned start failure"); });
      return value;
    });
    vi.spyOn(hindsightModule, "createHindsightMemorySubsystem").mockImplementation((input) => {
      const value = nativeConstructor(input); hindsights.push(value); return value;
    });
    const source = createConfigSource({ repo: createConfigRepo(h.db), env: { TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18481" } });
    const { logger } = createCaptureLogger(); const secrets = hindsightFixtureSecrets().catalog;
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:18481", resolveApiKey: () => "fixture-key",
      transport: async () => { throw new Error("owned fixture remains offline"); } });
    runtime = composeMemoryRuntime({ db: h.db, dataDir: h.dataDir, promptDir: join(h.dataDir, "prompt"),
      bootId: "cycles", model: failingGenerateModel(new Error("no model calls")), timeline: h.timeline,
      summaries: createSummaryRepo(h.db), windowStart: () => 1, estimatedTokens: () => 0, budget: () => 100_000,
      compact: { triggerRatio: 0.8, keepMessages: 3 }, env: {}, logger, hindsight: { source, secrets, client } });
    } });
    try {
      expect(runtime.hindsightBindingSnapshot().binding.kind).toBe("published");
      runtime.start();
      expect(hindsights[0]!.scheduler.started()).toBe(true);
      await runtime.transitions.quiesce({ ...f.input, timeoutMs: 1000 });
      const first = commitTransitionStage(f);
      await expect(runtime.transitions.bind(f.intent.transitionId)).rejects.toThrow("owned start failure");
      expect(readMemoryAuthoritySelection(f.db).epochId).toBe(first.newEpochId);
      expect(runtime.bindingSnapshot().binding.kind).toBe("unavailable");
      expect(() => hindsights[0]!.workFence.admitSync(() => undefined)).toThrow();
      await runtime.transitions.bind(f.intent.transitionId);
      expect(runtime.bindingSnapshot().binding).toEqual({ kind: "published", epochId: first.newEpochId });
      const oldRun = await runtime.captureRun("taki");
      completeTransitionStage(f, first);
      let previous: TransitionStageFixture = f; let previousReceipt = first;
      for (let cycle = 0; cycle < 2; cycle++) {
        const entering = reenterTransitionStage(previous, previousReceipt);
        await runtime.transitions.quiesce({ ...entering.input, timeoutMs: 1000 });
        const target = commitTransitionStage(entering);
        await expect(runtime.transitions.bind(entering.intent.transitionId)).rejects.toThrow("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
        expect(runtime.hindsightBindingSnapshot().binding.kind).not.toBe("published");
        for (const proof of entering.proofs) recordTransitionNativeOutcome(f.db, { ...entering.input,
          status: transitionOutcomeFixture(proof.status, target.receiptId) });
        await runtime.transitions.bind(entering.intent.transitionId);
        expect(runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "published", epochId: target.newEpochId });
        expect(hindsights.at(-1)!.scheduler.started()).toBe(true);
        completeTransitionStage(entering, target);
        expect(() => locals.at(-1)!.fence.admitSync(() => undefined)).toThrow();
        expect(oldRun.snapshot.authorityEpochId).toBe(first.newEpochId);
        await expect(oldRun.tools.retain!.execute!({ content: "stale closure", layer: "episodes", context: null },
          { toolCallId: "stale", messages: [] } as never)).resolves.toMatchObject({ ok: false, code: "MEMORY_AUTHORITY_FENCED" });
        if (cycle === 0) {
          const returning = returnTransitionStage(entering, target);
          await runtime.transitions.quiesce({ ...returning.input, timeoutMs: 1000 });
          const local = commitTransitionStage(returning);
          await runtime.transitions.bind(returning.intent.transitionId); completeTransitionStage(returning, local);
          previous = returning; previousReceipt = local;
        } else {
          const reopened = openDatabase({ path: join(f.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
          try { expect(readMemoryAuthoritySelection(reopened).epochId).toBe(target.newEpochId); } finally { reopened.close(); }
        }
      }
      expect(f.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(4);
      expect(hindsights).toHaveLength(3); expect(locals).toHaveLength(3);
    } finally { await runtime.stop(); await f.close(); }
  }, 30_000);
});
