import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryTemplatePreviewParams } from "@taki/shared";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { applyHindsightBank } from "./hindsight-bank-setup.ts";
import { setupTargets } from "./hindsight-setup-stages.ts";
import { createHindsightRuntimeConnection } from "./hindsight-runtime-connection.ts";
import * as subsystems from "./hindsight-memory-subsystem.ts";
import { templateLifecycleFixture } from "./template-lifecycle/template-lifecycle-fixtures.ts";
import { readCurrentRuntimeTemplateIdentity, readTemplateSelectionIdentity } from "./template-lifecycle/template-runtime-selection.ts";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function observeBindings() {
  const values: ReturnType<typeof subsystems.createHindsightMemorySubsystem>[] = [];
  const create = subsystems.createHindsightMemorySubsystem;
  vi.spyOn(subsystems, "createHindsightMemorySubsystem").mockImplementation((input) => {
    const value = create(input); values.push(value); return value;
  });
  return values;
}

// Failure modes: sanctioned mutation must retire old owners before dispatch, dynamic v1 routes
// must remain visible without a rebind, and transitioned references must never revive.
describe("runtime template identity and binding lifetime", () => {
  it("retires and freshly binds for sanctioned apply, Bank revision and defaults changes", async () => {
    const bindings = observeBindings(); const f = templateLifecycleFixture(); const composed = f.base.compose();
    // Exercise real retirement/rebinding; the existing fixture still owns synthetic Native synchronization.
    f.deps.runtime.quiesce = composed.templates.quiesce;
    f.deps.runtime.replaceBinding = composed.templates.replaceBinding;
    f.deps.runtime.boundSelectionIdentity = composed.templates.boundSelectionIdentity;
    const initial = f.params();
    if (initial.target.kind !== "defaults") throw new Error("fixture defaults missing");
    initial.target.globalTemplateRevision = "taki-bank-v2"; initial.target.characterTemplateRevision = "taki-bank-v2";
    const revision: MemoryTemplatePreviewParams = { target: { kind: "bank", bankId: f.bindings[1].externalBankId,
      templateRevision: "taki-bank-v3", userChoices: null }, enrollment: "fresh", directives: [], refresh: [] };
    try {
      for (const params of [initial, revision, f.params()]) {
        const old = bindings.at(-1)!.state.runtime;
        const count = bindings.length; const previousIdentity = old.templateSelectionIdentity;
        const apply = f.native.client.templateApply!;
        const dispatch = vi.spyOn(f.native.client, "templateApply").mockImplementation(async (input) => {
          expect(() => old.assertConnection()).toThrow("MEMORY_OPERATION_CANCELLED");
          expect(composed.operations()).toBeNull();
          return apply(input);
        });
        const operation = f.owner.submit(await f.request(params)); await f.owner.stop();
        expect(f.owner.status(operation.operationId)).toMatchObject({ state: "completed", result: { outcome: "bound" } });
        expect(dispatch).toHaveBeenCalled(); dispatch.mockRestore();
        expect(bindings).toHaveLength(count + 1);
        const current = bindings.at(-1)!.state.runtime;
        expect(current).not.toBe(old);
        expect(() => old.assertConnection()).toThrow("MEMORY_OPERATION_CANCELLED");
        expect(current.templateSelectionIdentity).not.toBe(previousIdentity);
        expect(current.templateSelectionIdentity).toBe(readTemplateSelectionIdentity(f.db, "epoch"));
        expect(readCurrentRuntimeTemplateIdentity(f.db, "epoch")).toBe(current.templateSelectionIdentity);
        current.assertConnection();
      }
    } finally { await f.close(); }
  }, 30_000);

  it("sees a newly provisioned legacy Character on the same bound connection", async () => {
    const f = hindsightRuntimeFixture();
    const runtime = createHindsightRuntimeConnection({ db: f.db, epochId: "epoch", config: f.source,
      secrets: f.secrets.catalog, client: f.remote.client });
    const target = setupTargets("taki-bank-v1", "new-character")[1]!;
    try {
      expect(runtime.routedBanks("new-character")).toBeUndefined();
      const client = { ...f.remote.client,
        createOrUpdateBank: vi.fn(async (bankId: string) => ({ bankId, name: null })),
        importTemplate: vi.fn(async () => ({ bank_id: target.binding.externalBankId, config_applied: true, dry_run: false, operation_ids: [] })),
        exportTemplate: vi.fn(async () => target.template.manifest) };
      await applyHindsightBank({ deps: { bankRepo: f.setup, client, connection: runtime.connection,
        wait: async () => undefined, now: () => W3_AT }, target, signal: new AbortController().signal });
      expect(client.createOrUpdateBank).toHaveBeenCalledOnce();
      expect(f.setup.get(target.binding.canonicalIdentity)?.status).toBe("verified");
      expect(runtime.routedBanks("new-character")?.[1].bankId).toBe(target.binding.externalBankId);
      expect(readCurrentRuntimeTemplateIdentity(f.db, "epoch")).toBeNull();
      expect(readTemplateSelectionIdentity(f.db, "epoch")).toBeNull();
      runtime.assertConnection();
    } finally { runtime.stop(); await f.close(); }
  });

  it("keeps the retired connection fenced through an actual healthy return and re-entry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT);
    const bindings = observeBindings(); const f = await createHealthyTransitionHarness();
    const old = bindings.at(-1)!.state.runtime;
    try {
      old.assertConnection();
      for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
        const operation = f.owner.submit(await f.request(undefined, kind)); await f.owner.stop();
        expect(f.owner.status(operation.operationId).state).toBe("completed");
        expect(() => old.assertConnection()).toThrow("MEMORY_OPERATION_CANCELLED");
      }
      const current = bindings.at(-1)!.state.runtime;
      expect(current).not.toBe(old); current.assertConnection();
    } finally { await f.close(); }
  }, 30_000);
});
