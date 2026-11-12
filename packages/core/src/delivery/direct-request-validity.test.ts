import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { directRequestReportFixture, commitDirectReply } from "../testing/direct-request-report-fixture.ts";
import { createDirectRequestReports } from "./direct-request-report.ts";
import { createPreparedPublicationAuthorization, readPreparedPublicationAuthorization } from "../harness/prepared-publication-authorization.ts";
import { capturePrimaryRequestWitness } from "../harness/primary-request-witness.ts";

const fixtures: Awaited<ReturnType<typeof directRequestReportFixture>>[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-25T12:00:00.000Z"); });
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); });
async function fixture(options?: Parameters<typeof directRequestReportFixture>[0]) {
  const f = await directRequestReportFixture(options); fixtures.push(f); return f;
}

describe("original-primary report validity", () => {
  it("retains a live source across days and gives one finite, idempotent final publication", async () => {
    const f = await fixture(); const acceptance = f.inputs.get(f.work.inputId).replyAcceptance!;
    expect(acceptance).toMatchObject({ validity: { kind: "until_cancelled" } });
    expect(f.runs.status(acceptance.acceptedRootRunId).run.deadlineAt).toBeUndefined();
    vi.setSystemTime("2026-10-28T12:00:00.000Z");
    expect(f.reports.canReply(f.work.inputId)).toBe(true);
    const reply = await commitDirectReply(f);
    await f.reports.stageReply(reply);
    const result = f.executions.result(reply.completionId)!;
    expect(result.publication).toMatchObject({ state: "recorded" });
    const delivery = f.deliveries.get(result.publication!.runId!)!;
    expect(delivery.expiresAt).toBe("2026-10-28T12:05:00.000Z");
    expect(f.runs.status(acceptance.acceptedRootRunId).run.state).toBe("completed");
    expect(f.reports.canReply(f.work.inputId)).toBe(false);
    await f.reports.stageReply(reply);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.model.doStreamCalls).toHaveLength(0);
  });

  it("does not renew an expired proposed candidate after foreground deferral", async () => {
    const f = await fixture(); const reply = await commitDirectReply(f);
    const release = f.queue.tryAcquireBackground("taki")!;
    await f.reports.stageReply(reply);
    expect(f.executions.result(reply.completionId)?.publication).toMatchObject({ state: "deferred", reason: "foreground_busy" });
    vi.setSystemTime("2026-10-25T12:05:00.000Z");
    release(); await f.reports.stageReply(reply);
    expect(f.executions.result(reply.completionId)?.publication).toMatchObject({ state: "refused", reason: "revision_unavailable" });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.work.workValidity).toEqual({ kind: "until_cancelled" });
  });

  it("uses the original legacy proposal time even if first staging is delayed", async () => {
    const f = await fixture(); const reply = await commitDirectReply(f);
    vi.setSystemTime("2026-10-25T12:05:00.000Z");
    await f.reports.stageReply(reply);
    expect(f.executions.result(reply.completionId)?.publication).toMatchObject({ state: "refused", reason: "revision_unavailable" });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("rechecks finite delivery freshness at the final transaction for an unlimited source", async () => {
    const f = await fixture(); const reply = await commitDirectReply(f);
    f.hooks.beforeCommit = () => vi.setSystemTime("2026-10-25T12:05:00.000Z");
    await f.reports.stageReply(reply);
    const result = f.executions.result(reply.completionId)!;
    expect(result.publication).toMatchObject({ state: "recorded" });
    expect(f.deliveries.get(result.publication!.runId!)?.state).toBe("expired");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.timeline.latestAscending("taki", 20).filter((row) => row.role === "assistant")).toEqual([]);
  });

  it("keeps the final-answer right after silent handling and later same-work input", async () => {
    const f = await fixture(); const silent = await commitDirectReply(f, "no_action");
    await expect(f.reports.stageReply(silent)).rejects.toThrow("SUBAGENT_PARENT_RESULT_CONFLICT");
    expect(f.reports.canReply(f.work.inputId)).toBe(true);
    expect(f.executions.result(silent.completionId)?.publication).toEqual({ state: "no_action" });
    f.inputs.accept({ subagentId: f.child.subagentId, operationKey: "follow-up", sender: { kind: "parent", runId: f.parent.run.runId },
      direction: "Continue the same research and return the final answer.", materials: [], input: { kind: "message",
        workInputId: f.work.inputId, expectedControlVersion: f.children.get(f.child.subagentId).controlVersion } });
    vi.setSystemTime("2026-10-28T12:00:00.000Z");
    const reply = await commitDirectReply(f);
    await f.reports.stageReply(reply);
    expect(f.executions.result(reply.completionId)?.publication).toMatchObject({ state: "recorded" });
    expect(f.send).toHaveBeenCalledOnce();
  });

  it.each(["cancel", "user_row_lost", "authority_lost"] as const)("revokes source authorization on %s", async (reason) => {
    const f = await fixture();
    const reply = await commitDirectReply(f);
    if (reason === "cancel") f.reports.closeWork(f.work.inputId);
    else if (reason === "user_row_lost") f.timeline.deleteEntry("taki", f.userEntry.seq);
    else f.authority.current = false;
    expect(f.reports.canReply(f.work.inputId)).toBe(false);
    await f.reports.stageReply(reply);
    expect(f.executions.result(reply.completionId)?.publication).toMatchObject({ state: "refused", reason: "reply_authority_unavailable" });
    expect(f.send).not.toHaveBeenCalled();
  });

  it.each([undefined, 5])("cannot recreate lost acceptance for lifetime %s, including stale pre-acceptance input", async (lifetimeMinutes) => {
    const f = await fixture({ lifetimeMinutes });
    const acceptance = f.inputs.get(f.work.inputId).replyAcceptance!;
    expect(acceptance).toMatchObject({ validity: lifetimeMinutes === undefined ? { kind: "until_cancelled" }
      : { kind: "expires_at", expiresAt: "2026-10-25T12:05:00.000Z" } });
    const restored = createDirectRequestReports(f.deps);
    try {
      expect(restored.canReply(f.work.inputId)).toBe(false);
      await expect(restored.capturePrimary(f.binding, f.inputs.get(f.work.inputId))).rejects.toThrow("SUBAGENT_REPLY_UNAVAILABLE");
      await expect(restored.capturePrimary(f.binding, f.work)).rejects.toThrow("SUBAGENT_REPLY_UNAVAILABLE");
      vi.setSystemTime("2026-10-25T12:05:00.000Z");
      expect(f.reports.canReply(f.work.inputId)).toBe(lifetimeMinutes === undefined);
      expect(restored.canReply(f.work.inputId)).toBe(false);
    } finally { await restored.close(); }
  });

  it("requires the exact live witness and freezes unlimited scope independently of caller objects", async () => {
    const f = await fixture({ capture: false });
    const { witness } = capturePrimaryRequestWitness(f.deps, { binding: f.binding, work: f.work });
    let current = true;
    const scope = { sourceRef: `direct-request-report:${f.work.inputId}`, acceptanceRef: f.work.inputId,
      characterId: "taki", deliveryClass: "class_a" as const, validity: { kind: "until_cancelled" as const } };
    const handle = createPreparedPublicationAuthorization({ scope, originalRequestWitness: witness, isCurrent: () => current });
    vi.setSystemTime("2026-11-25T12:00:00.000Z");
    const accepted = readPreparedPublicationAuthorization(handle, scope)!;
    expect(accepted).toEqual(scope); expect(Object.isFrozen(accepted.validity)).toBe(true);
    expect(readPreparedPublicationAuthorization({ ...handle }, scope)).toBeUndefined();
    expect(readPreparedPublicationAuthorization(handle, { ...scope, validity: { kind: "expires_at", expiresAt: "2026-12-25T12:00:00.000Z" } })).toBeUndefined();
    for (const originalRequestWitness of [{ ...witness }, JSON.parse(JSON.stringify(witness))]) {
      expect(() => createPreparedPublicationAuthorization({ scope, originalRequestWitness, isCurrent: () => true }))
        .toThrow("PREPARED_ORIGINAL_REQUEST_REQUIRED");
    }
    current = false; expect(readPreparedPublicationAuthorization(handle, scope)).toBeUndefined();
  });

  it("does not lose a committed child Stop while report acceptance awaits its captured root", async () => {
    const f = await fixture({ capture: false });
    f.service.state.deps.reports = f.reports;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const admit = f.runs.admitAcceptedWork.bind(f.runs);
    const delayed = vi.spyOn(f.runs, "admitAcceptedWork").mockImplementation(async (...args) => {
      await pending; return admit(...args);
    });
    const acceptance = f.reports.capturePrimary(f.binding, f.work);
    try {
      f.service.stop({ characterId: "taki", target: { subagentId: f.child.subagentId, workInputId: f.work.inputId,
        expectedRunId: null, expectedControlVersion: f.children.get(f.child.subagentId).controlVersion } }, "user");
    } finally { release(); }
    await acceptance; delayed.mockRestore();
    expect(f.reports.canReply(f.work.inputId)).toBe(false);
    const accepted = f.inputs.get(f.work.inputId).replyAcceptance!;
    expect(f.runs.status(accepted.acceptedRootRunId).run.state).toBe("cancelled");
    expect(f.send).not.toHaveBeenCalled();
  });

  it("cannot turn a finite original request or mismatched primary row into unlimited authority", async () => {
    const f = await fixture({ lifetimeMinutes: 5, capture: false });
    expect(() => capturePrimaryRequestWitness(f.deps, { binding: { ...f.binding, userEntry: { ...f.userEntry, content: "Forged request" } }, work: f.work }))
      .toThrow("SUBAGENT_REPLY_UNAVAILABLE");
    const { witness } = capturePrimaryRequestWitness(f.deps, { binding: f.binding, work: f.work });
    expect(() => createPreparedPublicationAuthorization({ scope: { sourceRef: `direct-request-report:${f.work.inputId}`,
      acceptanceRef: f.work.inputId, characterId: "taki", validity: { kind: "until_cancelled" }, deliveryClass: "class_a" },
    originalRequestWitness: witness, isCurrent: () => true })).toThrow("PREPARED_ORIGINAL_REQUEST_REQUIRED");
  });
});
