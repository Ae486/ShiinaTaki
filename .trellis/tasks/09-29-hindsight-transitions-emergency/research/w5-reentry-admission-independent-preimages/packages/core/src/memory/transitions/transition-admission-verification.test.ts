import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { createConfigSource } from "../../config/config-source.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { createStructuredMemoryBlockRepo } from "../../db/structured-memory-block-repo.ts";
import { resolveHindsightConfig } from "../../config/hindsight-config.ts";
import { hindsightFixtureSecrets } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { composeMemoryTransitions } from "../../boot/memory-transition-boot.ts";
import { createMemoryOperationService } from "../operations/memory-operation-service.ts";
import { fakeSetup } from "../operations/memory-operation-fixtures.ts";
import { hindsightConnectionFingerprint } from "../hindsight/hindsight-compatibility-service.ts";
import { createHindsightConnectionSecret } from "../hindsight/hindsight-secret-refs.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import type { TransitionEvidenceContext } from "./transition-evidence-context.ts";
import { withTransitionEvidenceContext, withTransitionObservationContext } from "./transition-evidence-context.ts";
import { TransitionObservationStore } from "./transition-observation-store.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { MEMORY_OPERATION_KINDS } from "../operations/memory-operation-kinds.ts";
import { setupValidateKind } from "../operations/memory-operation-kind-setup.ts";
import type { MemoryOperationContext } from "../operations/memory-operation-contract.ts";
import * as native from "./transition-native-evidence.ts";
import * as identity from "./transition-current-identity.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function fixture() {
  const h = await createHealthyTransitionHarness();
  const returned = h.owner.submit(await h.request()); await h.owner.stop();
  expect(h.owner.status(returned.operationId).state).toBe("completed");
  createStructuredMemoryBlockRepo(h.db).replace({ blockId: "user-card", scope: { kind: "global", characterId: null },
    content: "Admission test Block.", actor: "user" });
  const config = createConfigSource({ repo: createConfigRepo(h.db), env: {
    TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18481" } });
  const secrets = hindsightFixtureSecrets().catalog;
  const connection = resolveHindsightConfig(config); expect(connection.state).toBe("ready");
  if (connection.state !== "ready") throw new Error("fixture connection unavailable");
  h.db.prepare("UPDATE hindsight_connection_state SET config_fingerprint=:fingerprint").run({
    fingerprint: hindsightConnectionFingerprint(connection.projection, createHindsightConnectionSecret(secrets).marker()) });
  const { logger } = createCaptureLogger();
  const service = composeMemoryTransitions({ db: h.db, config, secrets, runtime: h.runtime,
    ownerId: "admission-owner", actorId: "operator", logger, client: h.remote.client, now: () => h.clock.value });
  const owner = createMemoryOperationService({ db: h.db, live: () => null, setup: fakeSetup(), transition: service,
    bootId: "admission-owner", logger, now: () => h.clock.value, onChanged: () => undefined });
  const preview = await service.preview({ kind: "transition.reenter-hindsight" });
  const request = { kind: preview.kind, requestId: randomUUID(), previewId: preview.previewId,
    previewHash: preview.previewHash, expected: preview.expected, confirmation: "healthy-switch" as const };
  const counts = () => h.db.prepare("SELECT (SELECT count(*) FROM memory_operations) operations,(SELECT count(*) FROM memory_transition_intents) intents").get();
  return { h, service, owner, request, counts, close: async () => { await service.stop(); await owner.stop(); await h.close(); } };
}

describe("independent synchronous admission verification", () => {
  it("keeps costly real immutable verification inside the original preview lifetime without borrowing observer work", async () => {
    const f = await fixture();
    try {
      const original = native.verifyTransitionNativeEvidence;
      vi.spyOn(native, "verifyTransitionNativeEvidence").mockImplementation((evidence) => {
        const result = original(evidence);
        f.h.clock.value = new Date(Date.parse(f.h.clock.value) + 45_000).toISOString();
        return result;
      });
      const admitted = f.owner.submit(f.request);
      expect(Date.parse(f.h.clock.value) - Date.parse(W3_AT)).toBe(90_000);
      f.owner.cancel(admitted.operationId); await f.owner.stop();
    } finally { await f.close(); }
  });

  it("shares immutable work across both plans, epoch stamp and default Local readiness, then closes before execution", async () => {
    const f = await fixture();
    try {
      const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      const plans = vi.spyOn(f.service, "plan");
      const snapshots = vi.spyOn(f.h.runtime, "bindingSnapshot");
      const admitted = f.owner.submit(f.request);
      expect(plans).toHaveBeenCalledTimes(2);
      const context = plans.mock.calls[0]![1] as TransitionEvidenceContext;
      expect(context).toBeDefined(); expect(plans.mock.calls[1]![1]).toBe(context);
      expect(snapshots.mock.calls).toEqual([[context], [context]]);
      const ids = verify.mock.calls.map(([evidence]) => evidence.evidenceId);
      expect(ids.length).toBeGreaterThan(0); expect(new Set(ids).size).toBe(ids.length);
      expect(() => context.assertOwner(f.h.db)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(f.owner.submit(f.request).operationId).toBe(admitted.operationId);
      expect(plans).toHaveBeenCalledTimes(2);
      f.owner.cancel(admitted.operationId); await f.owner.stop();
      verify.mockClear();
      f.h.runtime.bindingSnapshot();
      expect(verify).toHaveBeenCalled(); // The next independent boundary cannot borrow admission or observer work.
    } finally { await f.close(); }
  });

  it.each([1, 2])("refuses expiry after expensive plan %s and rolls back without dispatch", async (expirePlan) => {
    const f = await fixture(); const before = f.counts();
    try {
      const read = identity.readHealthyTransitionIdentity; let calls = 0;
      const plans = vi.spyOn(f.service, "plan");
      vi.spyOn(identity, "readHealthyTransitionIdentity").mockImplementation((...args) => {
        const result = read(...args);
        if (++calls === expirePlan) f.h.clock.value = new Date(Date.parse(f.h.clock.value) + 120_001).toISOString();
        return result;
      });
      expect(() => f.owner.submit(f.request)).toThrow("MEMORY_TRANSITION_STALE");
      expect(plans).toHaveBeenCalledTimes(expirePlan);
      expect(f.counts()).toEqual(before);
    } finally { await f.close(); }
  });

  it.each(["configuration", "block", "binding", "expiry"])("retains the second-plan current %s guard and transaction rollback", async (change) => {
    const f = await fixture(); const before = f.counts();
    try {
      const plan = f.service.plan; let calls = 0; let context: TransitionEvidenceContext | undefined;
      vi.spyOn(f.service, "plan").mockImplementation((...args) => {
        context = args[1];
        if (++calls === 2) {
          if (change === "configuration") f.h.db.exec("UPDATE hindsight_connection_state SET revision=revision+1");
          if (change === "block") f.h.db.exec("UPDATE taki_memory_blocks SET revision=revision+1");
          if (change === "binding") vi.spyOn(f.h.runtime, "hasPublishedBinding").mockReturnValue(false);
          if (change === "expiry") f.h.clock.value = new Date(Date.parse(f.h.clock.value) + 120_001).toISOString();
        }
        return plan(...args);
      });
      expect(() => f.owner.submit(f.request)).toThrow("MEMORY_TRANSITION_STALE");
      expect(calls).toBe(2); expect(f.counts()).toEqual(before);
      expect(() => context!.assertOwner(f.h.db)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    } finally { vi.restoreAllMocks(); await f.close(); }
  });

  it("never exposes the transaction context to the deferred transition executor", async () => {
    const f = await fixture();
    try {
      let called = false;
      vi.spyOn(f.service, "execute").mockImplementation(async (input) => {
        await Promise.resolve(); called = true;
        expect(input.ctx.admissionVerification).toBeUndefined();
        return null;
      });
      f.owner.submit(f.request); await f.owner.stop(); expect(called).toBe(true);
    } finally { await f.close(); }
  });

  it("rejects observer, foreign and closed scopes before admission or runtime snapshot validation", async () => {
    const f = await fixture(); const other = openDatabase({ path: ":memory:", migrations: [] });
    const store = new TransitionObservationStore(f.h.db); let closed: TransitionEvidenceContext | undefined;
    try {
      withTransitionEvidenceContext(other, (context) => {
        expect(() => f.service.plan(f.request, context)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        expect(() => f.h.runtime.bindingSnapshot(context)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      });
      withTransitionObservationContext({ db: f.h.db, receiptId: "observer", store }, (context) => {
        expect(() => f.service.plan(f.request, context)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        expect(() => f.h.runtime.hindsightBindingSnapshot(context)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      });
      withTransitionEvidenceContext(f.h.db, (context) => { closed = context; });
      expect(() => f.service.plan(f.request, closed)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      expect(() => withTransitionEvidenceContext(f.h.db, () => ({ then: () => undefined }))).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
    } finally { store.close(); other.close(); await f.close(); }
  });

  it("leaves nontransition admission and async execution on the unchanged context", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const contexts: MemoryOperationContext[] = [];
    const owner = createMemoryOperationService({ db, live: () => null, setup: fakeSetup(), bootId: "setup-owner",
      logger: createCaptureLogger().logger, onChanged: () => undefined,
      kinds: { ...MEMORY_OPERATION_KINDS, "setup.validate": { ...setupValidateKind,
        admit: (request, ctx, admission) => { contexts.push(ctx); return setupValidateKind.admit(request, ctx, admission); },
        execute: async (input) => { await Promise.resolve(); contexts.push(input.ctx); return setupValidateKind.execute(input); },
      } } });
    try {
      const operation = owner.submit({ kind: "setup.validate", expectedRevision: 0 }); await owner.stop();
      expect(owner.status(operation.operationId).state).toBe("completed");
      expect(contexts).toHaveLength(2); expect(contexts[0]).toBe(contexts[1]);
      expect(contexts[0]?.admissionVerification).toBeUndefined();
    } finally { await owner.stop(); db.close(); }
  });
});
