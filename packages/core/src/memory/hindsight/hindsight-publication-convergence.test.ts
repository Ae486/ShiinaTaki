import { expect, it, vi } from "vitest";
import type { HindsightApplicationCommandJob } from "../../db/hindsight-application-command-contract.ts";
import { createNativeFixtureClient, hindsightApplicationClientOverlay, hindsightFixtureSecrets } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { createHindsightApplicationSyncRunner } from "./hindsight-application-sync-runner.ts";
import { curatorTestAssessDriver, curatorTestFixture, curatorTestPolicy } from "./hindsight-policy-curator-fixtures.ts";

// Diagnostic: receipt acceptance, exact local application and completed Bank maintenance
// are separate milestones. A held later binding pass must not hide which one occurred.
it("keeps curator work saved after its exact publication is applied while subsequent binding is held", async () => {
  const driver = vi.fn(curatorTestAssessDriver);
  const f = curatorTestFixture({ driver });
  const bank = f.banks[0]!;
  const remote = hindsightApplicationClientOverlay(f.banks);
  const client = { ...createNativeFixtureClient({ ...remote, secrets: hindsightFixtureSecrets().catalog }), ...remote.overlay };
  const milestones: string[] = [];
  let receiptJob: HindsightApplicationCommandJob | undefined;
  let entered!: () => void;
  let release!: () => void;
  const bindingEntered = new Promise<void>((resolve) => { entered = resolve; });
  const bindingReleased = new Promise<void>((resolve) => { release = resolve; });
  const execute = f.writer.run;
  vi.spyOn(f.writer, "run").mockImplementation(async (input) => {
    const result = await execute(input);
    if (result.status === "completed") {
      receiptJob = result.job;
      milestones.push("receipt-persisted");
    }
    return result;
  });
  const sync = createHindsightApplicationSyncRunner({
    client, repo: f.replica, authority: f.authority, bankScope: () => bank.bankScope,
    requestTimeoutMs: 30_000, now: () => f.clock.at,
    onApplied: () => { milestones.push("target-event-applied"); },
    bind: async () => {
      milestones.push("subsequent-binding-entered");
      entered();
      await bindingReleased;
      milestones.push("subsequent-binding-finished");
      return false;
    },
  });
  f.deps.refreshBank = async (bankId, context) => {
    const lease = f.replica.leases.acquire({ bankId, ownerId: "publication-diagnostic", durationMs: context.timeoutMs });
    try {
      await sync.run({ bank: { bankId, scope: bank.bankScope.kind, characterId: bank.bankScope.characterId },
        signal: context.signal ?? new AbortController().signal,
        deadlineAt: new Date(Date.parse(f.clock.at) + context.timeoutMs).toISOString(),
        run: { lease, kind: "incremental", trigger: "catch_up", predecessor: f.replica.nativeCheckpoint(bankId)! } });
      milestones.push("bank-refresh-returned");
    } finally { f.replica.leases.release(lease); }
  };
  let finished = false;
  const running = f.curator.runNow("taki").then((result) => { finished = true; return result; });
  try {
    await Promise.race([bindingEntered, running.then(() => { throw new Error("curator ended before the diagnostic binding hold"); })]);
    expect(milestones).toEqual(["receipt-persisted", "target-event-applied", "subsequent-binding-entered"]);
    expect(receiptJob).toBeDefined();
    expect(f.replica.checkpoint(bank.scope.bankId)?.checkpoint).toEqual(receiptJob!.receipt!.checkpoint);
    expect(f.writer.applied(receiptJob!)).toBe(true);
    expect(curatorTestPolicy(f).assessment.state).toBe("assessed");
    expect(f.db.prepare("SELECT state FROM hindsight_policy_work WHERE work_kind='policy'").get()?.state).toBe("saved");
    expect(finished).toBe(false);

    release();
    expect(await running).toMatchObject({ status: "ran", assessed: 1, edits: 1, pending: 0 });
    expect(milestones).toEqual(["receipt-persisted", "target-event-applied", "subsequent-binding-entered",
      "subsequent-binding-finished", "bank-refresh-returned"]);
    expect(f.db.prepare("SELECT state FROM hindsight_policy_work WHERE work_kind='policy'").get()?.state).toBe("completed");
    expect(driver).toHaveBeenCalledOnce();
  } finally {
    release();
    await running;
    sync.stop();
    await sync.settle();
    await f.close();
    vi.restoreAllMocks();
  }
});
