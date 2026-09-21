import { afterEach, describe, expect, it } from "vitest";
import { MemoryOnboardingStatusSchema, type MemoryOperation, type MemoryOperationRequest } from "@taki/shared";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { cleanupLegacyMigrationFixtures, legacyEntry, PROFILE_ENTRY } from "../legacy-migration/legacy-migration-fixture.ts";
import { MemoryOperationRefusal } from "../operations/memory-operation-contract.ts";
import { createLocalOnboardingHarness, type LocalOnboardingHarness, type OnboardingOwner } from "./local-onboarding-fixture.ts";

afterEach(cleanupLegacyMigrationFixtures);

const BAD_ENTRY = "memory/global/profile/unsupported.md";
const legacyEntries = { [PROFILE_ENTRY]: legacyEntry("supported"), [BAD_ENTRY]: "---\nid: a\nid: b\n---\nx" };
const prepareNew = (previewId: string, replaceRunId?: string): MemoryOperationRequest =>
  ({ kind: "local.onboard.prepare", source: { mode: "new", previewId, ...(replaceRunId ? { replaceRunId } : {}) } });

/** Submits and awaits the owner's in-flight settlement; every status read must satisfy the strict wire schema. */
async function settle(owner: OnboardingOwner, request: MemoryOperationRequest): Promise<MemoryOperation> {
  const admitted = owner.service.submit(request);
  expect(admitted.state).toBe("admitted");
  MemoryOnboardingStatusSchema.parse(owner.status());
  await owner.service.stop();
  MemoryOnboardingStatusSchema.parse(owner.status());
  return owner.service.status(admitted.operationId);
}

function refusal(run: () => unknown): MemoryOperationRefusal {
  try { run(); } catch (error) { if (error instanceof MemoryOperationRefusal) return error; throw error; }
  throw new Error("expected a refusal");
}

async function preparedReady(h: LocalOnboardingHarness, owner = h.owner()) {
  const preview = await h.local.preview();
  const prepared = await settle(owner, prepareNew(preview.reportId));
  expect(prepared).toMatchObject({ state: "completed", result: { kind: "local", outcome: "ready", runtimeAvailable: false } });
  return { owner, preview, prepared, runId: (prepared.producer as { runId: string }).runId };
}

describe("local onboarding — empty workspace journey", () => {
  it("previews without side effects, prepares, activates once and repairs only on a second activate", async () => {
    const h = createLocalOnboardingHarness({ entries: {} });
    const owner = h.owner();
    const before = owner.status();
    expect(before).toMatchObject({ authority: { mode: "legacy-markdown", epochId: null }, run: null, operation: null,
      actions: { preview: true, prepare: true, resume: false, replace: false, activate: false, recoverBinding: false, cancelOperationId: null, retryOperationId: null } });
    expect(await h.local.preview()).toMatchObject({ sourceCount: 0 });
    expect(owner.status().run).toBeNull();
    const { runId } = await preparedReady(h, owner);
    const ready = owner.status();
    expect(ready.run).toMatchObject({ runId, status: "ready", progress: { phase: "ready", sourceCount: 0 }, receipt: null });
    expect(ready.actions).toMatchObject({ prepare: false, replace: true, resume: true, activate: true });
    expect(h.changes).toEqual(expect.arrayContaining(["candidate", "producer"]));

    const activated = await settle(owner, { kind: "local.onboard.activate", runId });
    expect(activated).toMatchObject({ state: "completed", result: { outcome: "activated", runtimeAvailable: true },
      producer: { kind: "local", runId, activationTransactionId: expect.any(String), progress: { phase: "completed" } } });
    const active = owner.status();
    expect(active.authority.mode).toBe("canonical-local");
    expect(active.runtime).toEqual({ available: true, unavailableReason: null });
    expect(active.run?.receipt).toMatchObject({ runId, epochId: active.authority.epochId, transactionId: (activated.producer as { activationTransactionId: string }).activationTransactionId });
    expect(active.actions).toMatchObject({ preview: false, prepare: false, activate: false, recoverBinding: false, reconcileSources: false });
    expect(h.changes.slice(-2)).toEqual(["candidate", "binding"]);

    // The exact committed run only repairs: healthy binding, no second transaction, receipt unchanged.
    const repaired = await settle(owner, { kind: "local.onboard.activate", runId });
    expect(repaired).toMatchObject({ state: "completed", result: { outcome: "activated" }, producer: { activationTransactionId: active.run?.receipt?.transactionId } });
    expect(h.recover).toHaveBeenCalledTimes(1);
    expect(h.f.db.prepare("SELECT count(*) AS n FROM memory_migration_activation_receipts").get()?.n).toBe(1);
    expect(owner.status().run?.receipt).toEqual(active.run?.receipt);
    expect(refusal(() => owner.service.submit(prepareNew("sha256:anything"))).reason).toBe("MEMORY_OPERATION_UNSUPPORTED");
  });
});

describe("local onboarding — legacy B2 journey", () => {
  it("blocks on an unsupported source, lists it as excludable, excludes it, resumes to ready and activates", async () => {
    const h = createLocalOnboardingHarness({ entries: legacyEntries });
    const owner = h.owner();
    const preview = await h.local.preview();
    const blocked = await settle(owner, prepareNew(preview.reportId));
    expect(blocked).toMatchObject({ state: "completed", result: { outcome: "source_blocked" }, producer: { progress: { phase: "blocked", sourceCount: 2, blockingCount: 1 } } });
    const runId = (blocked.producer as { runId: string }).runId;
    const status = owner.status();
    expect(status.run).toMatchObject({ runId, status: "running", progress: { phase: "blocked" } });
    expect(status.actions).toMatchObject({ activate: false, resume: true, replace: true });
    const page = h.local.exceptions({ runId, cursor: null, limit: 100 });
    expect(page.items).toEqual([{ sourceId: expect.any(String), code: expect.any(String), relativePath: "entries/global/profile/unsupported.md", canExclude: true }]);
    expect(page.nextCursor).toBeNull();

    const sourceId = page.items[0]!.sourceId;
    h.local.exclude({ runId, sourceId, reason: "unsupported frontmatter", actor: "device-1" });
    expect(h.changes.at(-1)).toBe("exclusion");
    expect(h.local.exclude({ runId, sourceId, reason: "unsupported frontmatter", actor: "device-1" })).toMatchObject({ blockingCount: 0 });
    expect(() => h.local.exclude({ runId, sourceId, reason: "changed", actor: "device-1" })).toThrow("MIGRATION_EXCLUSION_CONFLICT");
    expect(h.local.exceptions({ runId, cursor: null, limit: 100 }).items).toEqual([]);

    const resumed = await settle(owner, { kind: "local.onboard.prepare", source: { mode: "resume", runId } });
    expect(resumed).toMatchObject({ state: "completed", result: { outcome: "ready", runId }, producer: { previewId: null, snapshotId: status.run?.snapshotId } });
    const activated = await settle(owner, { kind: "local.onboard.activate", runId });
    expect(activated).toMatchObject({ state: "completed", result: { outcome: "activated", runtimeAvailable: true } });
    expect(readMemoryAuthoritySelection(h.f.db).mode).toBe("canonical-local");
    expect(() => h.local.exclude({ runId, sourceId, reason: "late", actor: "device-1" })).toThrow("MIGRATION_SOURCE_RESOLVED");
  });

  it("replaces a stale preparation only with an explicit replaceRunId and keeps the old run as evidence", async () => {
    const h = createLocalOnboardingHarness({ entries: { [PROFILE_ENTRY]: legacyEntry("supported") } });
    const { owner, runId } = await preparedReady(h);
    // A different source set changes the accepted preview; the old run stays but a plain prepare conflicts.
    h.f.write(PROFILE_ENTRY, legacyEntry("rewritten"));
    const preview = await h.local.preview();
    const conflict = await settle(owner, prepareNew(preview.reportId));
    expect(conflict).toMatchObject({ state: "failed", reason: "producer_failed", errorCode: "MIGRATION_CANDIDATE_CONFLICT" });
    expect(owner.status().actions).toMatchObject({ replace: true, resume: true });
    expect(refusal(() => owner.service.submit(prepareNew(preview.reportId, "missing-run"))).reason).toBe("MEMORY_OPERATION_NOT_FOUND");
    const replaced = await settle(owner, prepareNew(preview.reportId, runId));
    expect(replaced).toMatchObject({ state: "completed", result: { outcome: "ready" } });
    const next = owner.status();
    expect(next.run?.runId).not.toBe(runId);
    expect(h.local.run(runId)).toMatchObject({ status: "failed", supersededByRunId: next.run?.runId });
    expect(refusal(() => owner.service.submit({ kind: "local.onboard.prepare", source: { mode: "resume", runId } })).reason).toBe("MEMORY_OPERATION_NOT_FOUND");
  });
});

describe("local onboarding — admission, cancellation and lost replies", () => {
  it("refuses a duplicate submit with the active id, cancels only before claim and never runs a cancelled row", async () => {
    const h = createLocalOnboardingHarness({ entries: {} });
    const owner = h.owner();
    const preview = await h.local.preview();
    const first = owner.service.submit(prepareNew(preview.reportId));
    expect(refusal(() => owner.service.submit(prepareNew(preview.reportId)))).toMatchObject({ reason: "MEMORY_OPERATION_BUSY", activeOperationId: first.operationId });
    expect(owner.status().actions.cancelOperationId).toBe(first.operationId);
    expect(owner.service.cancel(first.operationId)).toMatchObject({ state: "cancelled", reason: "cancelled_before_claim" });
    await owner.service.stop();
    expect(owner.service.status(first.operationId).state).toBe("cancelled");
    expect(h.local.run((first.producer as { runId: string }).runId)).toBeNull();
    expect(h.f.db.prepare("SELECT count(*) AS n FROM memory_migration_runs").get()?.n).toBe(0);

    const second = owner.service.submit(prepareNew(preview.reportId));
    await h.tick(); await h.tick();
    expect(refusal(() => owner.service.cancel(second.operationId)).reason).toMatch(/MEMORY_OPERATION_(RUNNING|SETTLED)/);
    await owner.service.stop();
    expect(owner.service.status(second.operationId)).toMatchObject({ state: "completed", result: { outcome: "ready" } });
    // A client that lost the submit reply discovers the same run and command; nothing is resubmitted for it.
    expect(owner.service.latest("local-onboarding")?.operationId).toBe(second.operationId);
    expect(owner.status().run?.runId).toBe((second.producer as { runId: string }).runId);
  });

  it("stops between sources on shutdown, keeps the run resumable and refuses new claims afterwards", async () => {
    const entries = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`memory/global/profile/entry-${i}.md`, legacyEntry(`entry ${i}`)]));
    const h = createLocalOnboardingHarness({ entries });
    const owner = h.owner();
    const preview = await h.local.preview();
    const admitted = owner.service.submit(prepareNew(preview.reportId));
    const converting = () => owner.changes.some((change) => change.producer?.kind === "local" && change.producer.progress.phase === "converting");
    while (!converting()) await h.tick();
    const stopped = h.local.stop();
    await owner.service.stop();
    await stopped;
    const interrupted = owner.service.status(admitted.operationId);
    expect(interrupted).toMatchObject({ state: "failed", reason: "producer_incomplete", errorCode: "MIGRATION_INTERRUPTED" });
    expect(interrupted.producer).toMatchObject({ progress: { sourceCount: 4 } });
    expect((interrupted.producer as { progress: { resolvedCount: number } }).progress.resolvedCount).toBeLessThan(4);
    const status = owner.status();
    expect(status.run).toMatchObject({ status: "running" });
    expect(status.actions.retryOperationId).toBeNull();
    const refused = await settle(owner, { kind: "local.onboard.prepare", source: { mode: "resume", runId: status.run!.runId } });
    expect(refused).toMatchObject({ state: "failed", reason: "runtime_unavailable", errorCode: "MIGRATION_INTERRUPTED" });
  });
});
