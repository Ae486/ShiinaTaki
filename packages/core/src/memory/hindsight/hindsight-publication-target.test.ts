import { afterEach, expect, it, vi } from "vitest";
import type { HindsightApplicationCommandJob } from "../../db/hindsight-application-command-contract.ts";
import { createNativeFixtureClient, hindsightApplicationClientOverlay, hindsightFixtureSecrets } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { HindsightApplicationRefusal } from "./hindsight-application-client.ts";
import { createHindsightApplicationSyncRunner } from "./hindsight-application-sync-runner.ts";
import { curatorTestAssessDriver, curatorTestBank, curatorTestFixture, curatorTestPolicy, curatorTestRemotePolicy } from "./hindsight-policy-curator-fixtures.ts";
import { createHindsightRuntimeBankService } from "./hindsight-runtime-bank-service.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks(); });

function fixture() {
  const bank = curatorTestBank({ memories: [{ id: "memory-a" }, { id: "other", policy: { visibility: "hidden" } }] });
  const driver = vi.fn(curatorTestAssessDriver);
  const f = curatorTestFixture({ banks: [bank], driver });
  const remote = hindsightApplicationClientOverlay(f.banks);
  const client = { ...createNativeFixtureClient({ ...remote, secrets: hindsightFixtureSecrets().catalog }), ...remote.overlay };
  const binding = { bankId: bank.scope.bankId, scope: bank.bankScope.kind, characterId: bank.bankScope.characterId };
  const bind = vi.fn(async () => false);
  const sync = createHindsightApplicationSyncRunner({ client, repo: f.replica, authority: f.authority,
    bankScope: () => bank.bankScope, requestTimeoutMs: 30_000, now: () => f.clock.at, bind });
  const service = createHindsightRuntimeBankService({ replica: f.replica, sync, recovery: sync,
    bank: () => binding, assertConnection: () => undefined, onRecovered: async () => undefined, now: () => f.clock.at });
  f.deps.refreshBank = (bankId, context, receiptTarget) => service.synchronize({ bankId, context, receiptTarget });
  cleanup.push(async () => { await service.stop(); sync.stop(); await sync.settle(); await f.close(); });
  const journal = () => f.db.prepare("SELECT state,command_request_id FROM hindsight_policy_work WHERE work_kind='policy'").get()!;
  const job = () => f.writer.get({ authorityEpochId: "epoch", bankId: bank.scope.bankId, requestId: String(journal().command_request_id) })!;
  const otherEvent = () => curatorTestRemotePolicy(bank, "other", (value) => ({ ...value,
    policy: { ...value.policy, importance: value.policy.importance + 1, policyVersion: value.policy.policyVersion + 1 } }));
  return { ...f, bank, binding, driver, remote, client, bind, sync, service, journal, job, otherEvent };
}

it("applies preceding events and the entire target page, without fetching the next page or binding", async () => {
  const f = fixture(); f.otherEvent();
  const run = f.writer.run;
  vi.spyOn(f.writer, "run").mockImplementation(async (input) => {
    const result = await run(input); f.otherEvent(); f.otherEvent(); return result;
  });
  const changes = f.client.applicationChanges;
  const pages = vi.spyOn(f.client, "applicationChanges").mockImplementation(async (input) => {
    if (input.afterStateCursor !== 0) throw new Error("next page must remain deferred");
    const page = await changes(input); const current = page.changes.slice(0, 3);
    return { ...page, changes: current, to_checkpoint: current.at(-1)!.to_checkpoint, has_more: true };
  });
  const applied = vi.spyOn(f.writer, "applied");
  expect(await f.curator.runNow("taki")).toMatchObject({ status: "ran", assessed: 1, edits: 1, pending: 0 });
  expect(f.job().receipt?.checkpoint).toEqual({ native_cursor: 2, state_cursor: 2 });
  expect(f.replica.checkpoint(f.bank.scope.bankId)?.checkpoint).toEqual({ native_cursor: 2, state_cursor: 3 });
  expect(f.replica.record({ ...f.bank.scope, memoryId: "other", includeHidden: true })?.policy.importance).toBe(7);
  expect(curatorTestPolicy(f).assessment.state).toBe("assessed");
  expect(f.journal().state).toBe("completed");
  expect(pages).toHaveBeenCalledOnce(); expect(f.bind).not.toHaveBeenCalled();
  expect(applied).toHaveBeenCalledOnce(); expect(f.driver).toHaveBeenCalledOnce();
});

it.each(["event", "page-tail"] as const)("keeps work saved when the target page has malformed %s after the target", async (failure) => {
  const f = fixture(); const run = f.writer.run;
  vi.spyOn(f.writer, "run").mockImplementation(async (input) => { const result = await run(input); f.otherEvent(); return result; });
  const changes = f.client.applicationChanges;
  vi.spyOn(f.client, "applicationChanges").mockImplementation(async (input) => {
    const page = await changes(input);
    return failure === "event" ? { ...page, changes: [page.changes[0]!, { ...page.changes[1]!, event_hash: "0".repeat(64) }] }
      : { ...page, to_checkpoint: { ...page.to_checkpoint, state_cursor: page.to_checkpoint.state_cursor + 1 } };
  });
  expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 0, pending: 1 });
  expect(f.writer.applied(f.job())).toBe(true);
  expect(f.journal().state).toBe("saved"); expect(f.bind).not.toHaveBeenCalled();
});

it("does not complete cursor-covered work without the exact artifact history", async () => {
  const f = fixture(); const refresh = f.deps.refreshBank;
  f.deps.refreshBank = async (...input) => { await refresh(...input); vi.spyOn(f.replica, "artifact").mockReturnValue(undefined); };
  expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 0, pending: 1 });
  expect(f.replica.checkpoint(f.bank.scope.bankId)?.checkpoint).toEqual(f.job().receipt?.checkpoint);
  expect(f.journal().state).toBe("saved"); expect(f.bind).not.toHaveBeenCalled();
});

it("recovers already applied completed work without another writer dispatch or remote refresh", async () => {
  const f = fixture(); const refresh = f.deps.refreshBank;
  f.deps.refreshBank = async (...input) => { await refresh(...input); throw new Error("refresh return interrupted"); };
  expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", pending: 1 });
  const original = f.job(); expect(f.writer.applied(original)).toBe(true); expect(f.journal().state).toBe("saved");
  const execute = vi.spyOn(f.writer, "run"); const applied = vi.spyOn(f.writer, "applied");
  const unnecessary = vi.fn(async () => { throw new Error("recovery must use existing exact history"); });
  f.deps.refreshBank = unnecessary;
  f.clock.at = new Date(Date.parse(f.clock.at) + 60_000).toISOString();
  f.remote.control.offline = true;
  expect(await f.curator.runNow("taki")).toMatchObject({ status: "ran", assessed: 1, pending: 0 });
  expect(f.job().operationId).toBe(original.operationId); expect(f.journal().state).toBe("completed");
  expect(execute).not.toHaveBeenCalled(); expect(unnecessary).not.toHaveBeenCalled();
  expect(applied).toHaveBeenCalledOnce(); expect(f.driver).toHaveBeenCalledOnce();
});

it.each(["epoch", "namespace"] as const)("refuses a mismatched receipt %s before pulling and retains the original saved command", async (field) => {
  const f = fixture(); const refresh = f.deps.refreshBank;
  f.deps.refreshBank = (bankId, context, target) => refresh(bankId, context, {
    ...target!, ...(field === "epoch" ? { authorityEpochId: "another-epoch" }
      : { namespace: { ...target!.namespace, bank_generation: "44444444-4444-4444-8444-444444444444" } }) });
  const pages = vi.spyOn(f.client, "applicationChanges");
  expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", assessed: 0, pending: 1 });
  const original = f.job(); expect(original.state).toBe("completed"); expect(f.journal().state).toBe("saved");
  expect(pages).not.toHaveBeenCalled(); expect(f.bind).not.toHaveBeenCalled();
  f.deps.refreshBank = refresh; f.clock.at = new Date(Date.parse(f.clock.at) + 60_000).toISOString();
  expect(await f.curator.runNow("taki")).toMatchObject({ assessed: 1, pending: 0 });
  expect(f.job().operationId).toBe(original.operationId); expect(f.bank.server.receipts.size).toBe(1);
});

it("retains the accepted namespace and fixed deadline through a full reset without binding", async () => {
  const f = fixture(); let original: HindsightApplicationCommandJob | undefined;
  const execute = f.writer.run;
  vi.spyOn(f.writer, "run").mockImplementation(async (input) => {
    const result = await execute(input); original = result.job; return result;
  });
  const run = vi.spyOn(f.sync, "run");
  vi.spyOn(f.client, "applicationChanges").mockImplementationOnce(async () => {
    f.clock.at = new Date(Date.parse(f.clock.at) + 1000).toISOString();
    throw new HindsightApplicationRefusal({ error: "application_state_error", code: "state_reset_required",
      detail: "synthetic replay floor", checkpoint: original!.receipt!.checkpoint, minimum_state_cursor: 1 });
  });
  const snapshot = vi.spyOn(f.client, "createApplicationSnapshot");
  const baseline = vi.spyOn(f.client, "createLogicalSnapshot");
  expect(await f.curator.runNow("taki")).toMatchObject({ status: "ran", assessed: 1, pending: 0 });
  expect(run).toHaveBeenCalledOnce(); expect(snapshot).toHaveBeenCalledOnce(); expect(baseline).not.toHaveBeenCalled();
  const input = snapshot.mock.calls[0]![0];
  expect(input.request.namespace).toEqual(original!.namespace);
  expect(input.context.timeoutMs).toBeLessThanOrEqual(Date.parse(run.mock.calls[0]![0].deadlineAt!) - Date.parse(f.clock.at));
  expect(f.replica.checkpoint(f.bank.scope.bankId)?.checkpoint).toEqual(original!.receipt!.checkpoint);
  expect(f.bind).not.toHaveBeenCalled(); expect(f.journal().state).toBe("completed");
});

it("does not reinterpret a reset target in a replacement generation", async () => {
  const f = fixture(); const before = f.replica.checkpoint(f.bank.scope.bankId);
  vi.spyOn(f.client, "applicationChanges").mockRejectedValueOnce(new HindsightApplicationRefusal({
    error: "application_state_error", code: "state_reset_required", detail: "synthetic replay floor",
    checkpoint: before!.checkpoint, minimum_state_cursor: 1 }));
  vi.spyOn(f.client, "initializeApplication").mockImplementationOnce(async (input) => {
    expect(input.namespace).toEqual(f.bank.scope.namespace);
    throw new HindsightApplicationRefusal({ error: "application_state_error", code: "namespace_mismatch", detail: "replacement generation" });
  });
  const snapshot = vi.spyOn(f.client, "createApplicationSnapshot");
  expect(await f.curator.runNow("taki")).toMatchObject({ status: "failed", pending: 1 });
  expect(f.replica.checkpoint(f.bank.scope.bankId)).toEqual(before); expect(f.journal().state).toBe("saved");
  expect(snapshot).not.toHaveBeenCalled(); expect(f.bind).not.toHaveBeenCalled();
});

it.each(["native", "state"] as const)("continues past a page lacking target %s coverage and never uses binding to fill a missing goal", async (cursor) => {
  const f = fixture(); f.otherEvent(); f.otherEvent();
  const changes = f.client.applicationChanges;
  const pages = vi.spyOn(f.client, "applicationChanges").mockImplementation(async (input) => {
    const page = await changes(input); const current = page.changes.slice(0, 1);
    return { ...page, changes: current, to_checkpoint: current[0]!.to_checkpoint, has_more: page.changes.length > 1 };
  });
  await f.service.synchronize({ bankId: f.bank.scope.bankId, context: { timeoutMs: 30_000 }, receiptTarget: {
    authorityEpochId: "epoch", namespace: f.bank.scope.namespace,
    checkpoint: cursor === "native" ? { native_cursor: 3, state_cursor: 1 } : { native_cursor: 2, state_cursor: 2 } } });
  expect(pages).toHaveBeenCalledTimes(2); expect(f.bind).not.toHaveBeenCalled();
  expect(f.replica.checkpoint(f.bank.scope.bankId)?.checkpoint).toEqual({ native_cursor: 2, state_cursor: 2 });
});

it.each(["cancel", "lease", "rollback"] as const)("keeps the original work saved on %s at the target publication boundary", async (failure) => {
  const f = fixture(); const before = f.replica.checkpoint(f.bank.scope.bankId); const controller = new AbortController();
  if (failure === "rollback") {
    const changes = f.client.applicationChanges;
    vi.spyOn(f.client, "applicationChanges").mockImplementation(async (input) => {
      const page = await changes(input); return { ...page, to_checkpoint: { ...page.to_checkpoint, native_cursor: 1 } };
    });
  } else {
    const apply = f.replica.applyEvent;
    vi.spyOn(f.replica, "applyEvent").mockImplementation((input) => {
      const checkpoint = apply(input);
      if (failure === "cancel") controller.abort();
      else f.replica.leases.release(input.lease);
      return checkpoint;
    });
  }
  expect(await f.curator.runBank(f.binding, controller.signal)).toMatchObject({ status: "failed", assessed: 0 });
  if (failure === "rollback") expect(f.replica.checkpoint(f.bank.scope.bankId)).toEqual(before);
  else expect(f.writer.applied(f.job())).toBe(true);
  expect(f.job().state).toBe("completed"); expect(f.bank.server.receipts.size).toBe(1);
  expect(f.journal().state).toBe("saved"); expect(f.bind).not.toHaveBeenCalled();
});
