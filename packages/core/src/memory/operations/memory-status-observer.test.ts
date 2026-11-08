import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMORY_TEMPLATE_METHODS } from "@taki/shared";
import { composeHindsightTemplates } from "../../boot/hindsight-template-boot.ts";
import { createConfigSource } from "../../config/config-source.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { createHindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { publishMemoryTransition } from "../../db/memory-transition-publication-repo.ts";
import { createMethodRegistry, type MethodContext } from "../../server/method-registry.ts";
import { hindsightFixtureSecrets } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { createTransitionPublicationFixture } from "../../testing/memory-transition-publication-fixtures.ts";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { templateLifecycleFixture } from "../hindsight/template-lifecycle/template-lifecycle-fixtures.ts";
import { readHindsightActivationPlan } from "../hindsight-activation/hindsight-activation-reads.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { LocalBindingSnapshot } from "../local-runtime-binding.ts";
import * as native from "../transitions/transition-native-evidence.ts";
import { readMemoryAuthorityStatus } from "./memory-authority-status.ts";
import { fakeSetup } from "./memory-operation-fixtures.ts";
import { createMemoryStatusObserver } from "./memory-status-observer.ts";

afterEach(() => vi.restoreAllMocks());

function publicationRuntime(epochId: string) {
  const state: Pick<LocalBindingSnapshot, "binding" | "lifetime"> & { revision: number } = {
    binding: { kind: "published", epochId }, lifetime: "running", revision: 1,
  };
  return { state, hasPublishedBinding: (provider: "local" | "hindsight") => provider === "local" && state.binding.kind === "published",
    observeHindsightStatus: () => null, bindingPublication: (provider: "local" | "hindsight") => provider === "local"
    ? { ...state, binding: { ...state.binding } }
    : { binding: { kind: "none" as const }, lifetime: state.lifetime, revision: 0 } };
}

describe("operator memory status observation", () => {
  it("keeps bound template identity when a real REENTRY checkpoint fails before scheduler observation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT);
    const f = await createHealthyTransitionHarness();
    const observer = createMemoryStatusObserver({ db: f.db, runtime: f.runtime });
    try {
      for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
        const operation = f.owner.submit(await f.request(undefined, kind)); await f.owner.stop();
        expect(f.owner.status(operation.operationId).state).toBe("completed");
      }
      const identity = observer.readRuntime().boundSelectionIdentity;
      const live = f.runtime.operations()!;
      expect(observer.readRuntime().boundSelectionIdentity).toBe(identity);
      const bankId = live.banks()[0]!.bankId;
      const rollback = new Error("restore damaged checkpoint");
      expect(() => f.db.transaction(() => {
        f.db.prepare("UPDATE hindsight_application_replica_checkpoints SET checkpoint_hash=:hash WHERE bank_id=:bank")
          .run({ hash: "0".repeat(64), bank: bankId });
        expect(() => live.assertConnection()).toThrow("HINDSIGHT_APPLICATION_CHECKPOINT_INVALID");
        const view = observer.readRuntime();
        expect(view).toMatchObject({ boundSelectionIdentity: identity,
          runtime: { unavailableReason: "evidence_invalid", replica: null, pending: null } });
        expect(view.hindsightBinding.binding.kind).toBe("published");
        throw rollback;
      })).toThrow(rollback);
      expect(observer.readRuntime()).toMatchObject({ boundSelectionIdentity: identity, runtime: { unavailableReason: null } });
    } finally { observer.close(); await f.close(); vi.useRealTimers(); }
  }, 30_000);

  it("observes current identity without historical reconstruction while explicit proof reads remain independent", async () => {
    const f = await createTransitionPublicationFixture(); const receipt = publishMemoryTransition(f.db, f.prove());
    const runtime = publicationRuntime(receipt.newEpochId); const observer = createMemoryStatusObserver({ db: f.db, runtime });
    const operations = f.owner().service; const setup = fakeSetup();
    const registry = createMethodRegistry();
    const templates = composeHindsightTemplates({ db: f.db, config: createConfigSource({ repo: createConfigRepo(f.db), env: {} }),
      secrets: hindsightFixtureSecrets().catalog, bootId: "status-test", registry,
      runtime: { boundSelectionIdentity: () => null, quiesce: async () => undefined,
        synchronize: async () => undefined, replaceBinding: async () => undefined },
      statusObservation: () => observer.readRuntime() });
    const context: MethodContext = { connection: { state: { status: "authenticated", deviceId: "operator", role: "operator", capabilities: [] } },
      notify: () => undefined, close: () => undefined, onClose: () => undefined };
    const authorityInput = { db: f.db, live: () => null, setup, operations,
      liveConnection: () => ({ state: "unconfigured" as const, fingerprint: null }) };
    try {
      const expected = readMemoryAuthoritySelection(f.db); const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      expect(observer.read().selection).toMatchObject(expected);
      expect(verify).not.toHaveBeenCalled(); verify.mockClear();
      const view = observer.read();
      expect(readMemoryAuthorityStatus({ ...authorityInput, binding: () => view.localBinding }, view.selection).runtime.available).toBe(true);
      expect(readHindsightActivationPlan(f.db, { setup, fingerprint: () => null }, view.selection).authority.epochId).toBe(receipt.newEpochId);
      expect(await registry.dispatch({ jsonrpc: "2.0", id: 1, method: MEMORY_TEMPLATE_METHODS.status, params: {} }, context))
        .toMatchObject({ result: { supported: false, plan: null } });
      expect(verify).not.toHaveBeenCalled();
      for (const independent of [() => readMemoryAuthoritySelection(f.db), () => readHindsightActivationPlan(f.db, { setup, fingerprint: () => null })]) {
        verify.mockClear(); independent(); expect(verify).toHaveBeenCalledTimes(f.proofs.length);
      }
      verify.mockClear(); readMemoryAuthorityStatus(authorityInput); templates.status(); expect(verify).not.toHaveBeenCalled();
      // An RPC-only callback cannot leak into the original producer service.
      observer.close(); expect(() => observer.read()).toThrow("MEMORY_OPERATION_CANCELLED");
      expect(() => templates.status()).not.toThrow();
      expect(await registry.dispatch({ jsonrpc: "2.0", id: 2, method: MEMORY_TEMPLATE_METHODS.status, params: {} }, context)).toHaveProperty("error");
    } finally { templates.stop(); observer.close(); await operations.stop(); await f.close(); }
  });

  it.each(["marker", "native-evidence"])("keeps %s proof separate from the current control projection", async (damage) => {
    const f = await createTransitionPublicationFixture(); const receipt = publishMemoryTransition(f.db, f.prove());
    const observer = createMemoryStatusObserver({ db: f.db, runtime: publicationRuntime(receipt.newEpochId) });
    try {
      observer.read();
      if (damage === "native-evidence") f.db.exec("DROP TRIGGER memory_transition_native_evidence_immutable_update");
      const rollback = new Error("restore fixture");
      expect(() => f.db.transaction(() => {
        if (damage === "marker") f.db.prepare("UPDATE memory_authority_selection SET replica_checkpoint_digest=:digest").run({ digest: "0".repeat(64) });
        else f.db.prepare("UPDATE memory_transition_native_evidence SET body=CAST(json_set(CAST(body AS TEXT),'$.status.proof.proof_hash',:hash) AS BLOB)")
          .run({ hash: "0".repeat(64) });
        expect(observer.read().selection.epochId).toBe(receipt.newEpochId);
        expect(() => readMemoryAuthoritySelection(f.db)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
        throw rollback;
      })).toThrow(rollback);
      const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      expect(observer.read().selection.epochId).toBe(receipt.newEpochId);
      expect(verify).not.toHaveBeenCalled();
    } finally { observer.close(); await f.close(); }
  });

  it("observes binding replacement, failed observation and stop without retaining a mutable snapshot", async () => {
    const f = await createTransitionPublicationFixture(); const receipt = publishMemoryTransition(f.db, f.prove());
    const runtime = publicationRuntime(receipt.newEpochId); const observer = createMemoryStatusObserver({ db: f.db, runtime });
    try {
      const first = observer.read(); first.localBinding.binding = { kind: "none" };
      expect(observer.read().localBinding.binding.kind).toBe("published");
      const verify = vi.spyOn(native, "verifyTransitionNativeEvidence");
      runtime.state.revision++; runtime.state.binding = { kind: "unavailable", epochId: receipt.newEpochId, code: "MEMORY_LOCAL_BINDING_FAILED" };
      expect(observer.read().localBinding).toMatchObject({ binding: { kind: "unavailable" }, flush: "failing" });
      expect(verify).not.toHaveBeenCalled(); verify.mockClear();
      vi.spyOn(runtime, "bindingPublication").mockImplementationOnce(() => { throw new Error("owned status failure"); });
      expect(() => observer.read()).toThrow("owned status failure");
      observer.read(); expect(verify).not.toHaveBeenCalled(); verify.mockClear();
      runtime.state.revision++; runtime.state.lifetime = "stopped";
      expect(observer.read().localBinding).toMatchObject({ lifetime: "stopped", flush: "failing" });
      expect(verify).not.toHaveBeenCalled();
    } finally { observer.close(); await f.close(); }
  });

  it("matches the actual Hindsight binding through replacement, a durable template hold and stop", async () => {
    const f = templateLifecycleFixture(); const runtime = f.base.compose();
    const observer = createMemoryStatusObserver({ db: f.db, runtime });
    try {
      expect(observer.read().hindsightBinding).toEqual(runtime.hindsightBindingSnapshot());
      expect(observer.readRuntime()).toMatchObject({ runtime: { present: true, drift: "none", unavailableReason: null }, boundSelectionIdentity: null });
      await runtime.replaceHindsightBinding("epoch");
      expect(observer.read().hindsightBinding).toEqual(runtime.hindsightBindingSnapshot());
      expect(observer.readRuntime().runtime.unavailableReason).toBeNull();
      f.admit(await f.request());
      expect(observer.read().hindsightBinding).toEqual(runtime.hindsightBindingSnapshot());
      expect(observer.read().hindsightBinding).toMatchObject({ binding: { kind: "unavailable", code: "MEMORY_TEMPLATE_HOLD" }, flush: "failing" });
      expect(observer.readRuntime()).toMatchObject({ runtime: { unavailableReason: "template_hold", replica: null, pending: null }, boundSelectionIdentity: null });
      await runtime.stop();
      expect(observer.read().hindsightBinding).toEqual(runtime.hindsightBindingSnapshot());
      expect(observer.read().hindsightBinding.lifetime).toBe("stopped");
      expect(observer.readRuntime()).toMatchObject({ runtime: { unavailableReason: "stopped", replica: null, pending: null }, boundSelectionIdentity: null });
    } finally { observer.close(); await f.close(); }
  });

  it.each(["scheduler", "checkpoint"])("retains the real bound template identity when stored %s evidence is unreadable", async (damage) => {
    const f = templateLifecycleFixture();
    let observer: ReturnType<typeof createMemoryStatusObserver> | undefined;
    try {
      const operation = f.owner.submit(await f.request()); await f.owner.stop();
      expect(f.owner.status(operation.operationId).state).toBe("completed");
      const runtime = f.base.compose(); const live = runtime.operations()!;
      const bank = live.banks()[0]!;
      createHindsightReplicaSchedulerRepo(f.db).ensureBank({ bank });
      observer = createMemoryStatusObserver({ db: f.db, runtime });
      const bound = runtime.templates.boundSelectionIdentity();
      expect(bound).toEqual(expect.any(String));
      expect(observer.readRuntime().boundSelectionIdentity).toBe(bound);
      const table = damage === "scheduler" ? "hindsight_replica_sync_schedule" : "hindsight_application_replica_checkpoints";
      const column = damage === "scheduler" ? "state_json" : "checkpoint_hash";
      const original = f.db.prepare(`SELECT ${column} AS value FROM ${table} WHERE bank_id=:bank`).get({ bank: bank.bankId })!;
      f.db.prepare(`UPDATE ${table} SET ${column}=:value WHERE bank_id=:bank`)
        .run({ bank: bank.bankId, value: damage === "scheduler" ? "{}" : "0".repeat(64) });
      try {
        expect(() => live.scheduler.status()).toThrow();
        if (damage === "scheduler") expect(runtime.templates.boundSelectionIdentity()).toBe(bound);
        const view = observer.readRuntime();
        expect(view).toMatchObject({ boundSelectionIdentity: bound,
          runtime: { drift: "none", unavailableReason: "evidence_invalid", replica: null, pending: null } });
        expect(readMemoryAuthorityStatus({ db: f.db, live: () => live, setup: fakeSetup(), operations: f.owner,
          liveConnection: () => ({ state: "ready", fingerprint: live.configFingerprint }) }, view.selection, view))
          .toMatchObject({ runtime: { available: false, unavailableReason: "evidence_invalid" }, replica: null, pending: null });
      } finally {
        f.db.prepare(`UPDATE ${table} SET ${column}=:value WHERE bank_id=:bank`)
          .run({ value: original.value!, bank: bank.bankId });
      }
      expect(observer.readRuntime()).toMatchObject({ boundSelectionIdentity: bound, runtime: { unavailableReason: null } });
    } finally { observer?.close(); await f.close(); }
  });
});
