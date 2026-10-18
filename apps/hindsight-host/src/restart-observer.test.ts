import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { HindsightCustodyRefusal } from "@taki/shared/hindsight-custody";
import {
  FakeRestartObserver, type FakeGrantResult, type FakeResourceObservation, type FakeRestartAdapter,
  type FakeStartupGrant, type OriginalResource, type StartupAttempt,
} from "./restart-observer.ts";

class FakeAdapter implements FakeRestartAdapter {
  readonly original: OriginalResource = { resourceId: randomUUID(), operationId: randomUUID(), configurationDigest: "a".repeat(64) };
  resource: FakeResourceObservation | undefined = {
    resourceId: this.original.resourceId, startupId: randomUUID(), configurationDigest: this.original.configurationDigest, state: "waiting",
  };
  inspectCalls: string[] = [];
  grants: FakeStartupGrant[] = [];
  submitted: StartupAttempt[] = [];
  refusal: HindsightCustodyRefusal | undefined;
  currentReason: HindsightCustodyRefusal | undefined;
  loseAck = false;
  loseBeforeEffect = false;
  clock = Date.now();
  mutateGrant: (grant: FakeStartupGrant) => FakeStartupGrant = (grant) => grant;
  afterAuthorize: (() => void) | undefined;
  afterSubmit: (() => void) | undefined;

  async inspect(resourceId: string): Promise<FakeResourceObservation | undefined> {
    this.inspectCalls.push(resourceId);
    return this.resource ? { ...this.resource } : undefined;
  }

  async authorize(original: OriginalResource, startupId: string): Promise<FakeGrantResult> {
    if (this.refusal) return { reason: this.refusal };
    const grant = this.mutateGrant({
      kind: "c1b-fake-startup-grant", startupId, operationId: original.operationId,
      configurationDigest: original.configurationDigest, attemptId: randomUUID(), authorizationId: randomUUID(),
      deadlineAt: new Date(this.clock + 90_000).toISOString(), current: () => this.currentReason,
    });
    this.grants.push(grant);
    this.afterAuthorize?.();
    return grant;
  }

  async submit(grant: FakeStartupGrant): Promise<StartupAttempt> {
    this.submitted.push(grant);
    if (this.loseBeforeEffect) throw new Error("FAKE_PRIVATE_DIAGNOSTIC");
    this.resource = { ...this.resource!, state: "running", accepted: grant };
    this.afterSubmit?.();
    if (this.loseAck) throw new Error("FAKE_PRIVATE_DIAGNOSTIC");
    return grant;
  }

  observer(recovery?: StartupAttempt): FakeRestartObserver {
    return new FakeRestartObserver({ original: this.original, adapter: this, recovery,
      wallNow: () => this.clock, monotonicNow: () => this.clock });
  }

  restart(startupId: string = randomUUID()): void {
    this.resource = { resourceId: this.original.resourceId, startupId,
      configurationDigest: this.original.configurationDigest, state: "waiting" };
  }
}

describe("C1b fake restart observer", () => {
  it("uses the original resource, independent startup grant and one submission", async () => {
    const adapter = new FakeAdapter();
    const observer = adapter.observer();
    expect((await observer.reconcile()).state).toBe("running");
    expect((await observer.reconcile()).state).toBe("running");
    expect(adapter.submitted).toHaveLength(1);
    expect(adapter.grants).toHaveLength(1);
    expect(adapter.inspectCalls.every((id) => id === adapter.original.resourceId)).toBe(true);
    expect(observer.snapshot().deploymentReady).toBe(false);
  });

  it.each(["host-unavailable", "custody-locked", "snapshot-stale", "approval-required"] as const)(
    "%s leaves the owned waiting startup unstarted", async (reason) => {
      const adapter = new FakeAdapter();
      adapter.refusal = reason;
      const status = await adapter.observer().reconcile();
      expect(status).toMatchObject({ state: "unavailable", reason, deploymentReady: false });
      expect(adapter.submitted).toHaveLength(0);
    });

  it("does not create a missing resource or silently follow a replacement", async () => {
    const adapter = new FakeAdapter();
    const observer = adapter.observer();
    adapter.resource = undefined;
    expect((await observer.reconcile()).reason).toBe("host-unavailable");
    adapter.restart();
    adapter.resource = { ...adapter.resource!, resourceId: randomUUID() };
    expect((await observer.reconcile()).reason).toBe("snapshot-stale");
    expect(adapter.grants).toHaveLength(0);
    expect(adapter.submitted).toHaveLength(0);
  });

  it.each(["startupId", "operationId", "attemptId", "authorizationId", "configurationDigest"] as const)(
    "rejects a changed or malformed %s grant before effects", async (key) => {
      const adapter = new FakeAdapter();
      adapter.mutateGrant = (grant) => ({ ...grant, [key]: key === "configurationDigest" ? "b".repeat(64) : "not-an-id" });
      expect((await adapter.observer().reconcile()).reason).toBe("snapshot-stale");
      expect(adapter.submitted).toHaveLength(0);
    });

  it("never upgrades C1a preparation or operator JSON to a startup grant", async () => {
    const adapter = new FakeAdapter();
    adapter.mutateGrant = () => ({ state: "prepared", deploymentReady: false } as unknown as FakeStartupGrant);
    expect((await adapter.observer().reconcile()).reason).toBe("snapshot-stale");
    expect(adapter.submitted).toHaveLength(0);
  });

  it("rechecks startup and custody after authorization awaits", async () => {
    const adapter = new FakeAdapter();
    adapter.afterAuthorize = () => adapter.restart();
    expect((await adapter.observer().reconcile()).reason).toBe("snapshot-stale");
    expect(adapter.submitted).toHaveLength(0);
    adapter.afterAuthorize = () => { adapter.currentReason = "custody-locked"; };
    expect((await adapter.observer().reconcile()).reason).toBe("custody-locked");
    expect(adapter.submitted).toHaveLength(0);
  });

  it("keeps lost replies unknown until exact original-ID observation recovers them", async () => {
    const adapter = new FakeAdapter();
    adapter.loseAck = true;
    const observer = adapter.observer();
    const unknown = await observer.reconcile();
    expect(unknown.state).toBe("outcome-unknown");
    expect(JSON.stringify(unknown)).not.toContain("FAKE_PRIVATE_DIAGNOSTIC");
    expect((await observer.reconcile()).state).toBe("running");
    const recovered = adapter.observer(adapter.submitted[0]);
    expect((await recovered.reconcile()).state).toBe("running");
    expect(adapter.submitted).toHaveLength(1);
    expect(adapter.grants).toHaveLength(1);
  });

  it("does not replay an unknown dispatch even when the same startup still waits", async () => {
    const adapter = new FakeAdapter();
    adapter.loseBeforeEffect = true;
    const observer = adapter.observer();
    expect((await observer.reconcile()).state).toBe("outcome-unknown");
    expect((await observer.reconcile()).state).toBe("outcome-unknown");
    expect((await adapter.observer(adapter.submitted[0]).reconcile()).state).toBe("outcome-unknown");
    expect(adapter.submitted).toHaveLength(1);
  });

  it("requires fresh attempt and authorization IDs for a genuinely new startup", async () => {
    const adapter = new FakeAdapter();
    const observer = adapter.observer();
    await observer.reconcile();
    const original = adapter.submitted[0]!;
    adapter.restart();
    adapter.mutateGrant = (grant) => ({ ...grant, attemptId: original.attemptId });
    expect((await observer.reconcile()).reason).toBe("snapshot-stale");
    expect(adapter.submitted).toHaveLength(1);
    adapter.mutateGrant = (grant) => ({ ...grant, authorizationId: original.authorizationId });
    expect((await observer.reconcile()).reason).toBe("snapshot-stale");
    adapter.mutateGrant = (grant) => grant;
    expect((await observer.reconcile()).state).toBe("running");
    expect(adapter.submitted).toHaveLength(2);
    expect(adapter.submitted[1]!.operationId).toBe(original.operationId);
    adapter.restart(original.startupId);
    expect((await observer.reconcile()).state).toBe("outcome-unknown");
    expect(adapter.submitted).toHaveLength(2);
  });

  it("honors the original deadline and leaves a late dispatched outcome unknown", async () => {
    const adapter = new FakeAdapter();
    adapter.afterAuthorize = () => { adapter.clock += 90_001; };
    expect((await adapter.observer().reconcile()).reason).toBe("snapshot-stale");
    expect(adapter.submitted).toHaveLength(0);
    adapter.afterAuthorize = undefined;
    adapter.afterSubmit = () => { adapter.clock += 90_001; };
    const observer = adapter.observer();
    expect((await observer.reconcile()).state).toBe("outcome-unknown");
    expect((await observer.reconcile()).state).toBe("running");
    expect(adapter.submitted).toHaveLength(1);
  });

  it("does not restart a running process on rotation or turn observation retirement into ownership", async () => {
    const adapter = new FakeAdapter();
    const observer = adapter.observer();
    await observer.reconcile();
    adapter.currentReason = "custody-locked";
    expect((await observer.reconcile()).state).toBe("running");
    observer.close();
    expect((await observer.reconcile()).reason).toBe("host-unavailable");
    expect(adapter.resource!.state).toBe("running");
    expect(adapter.submitted).toHaveLength(1);
  });

  it("single-flights concurrent observations and fences retirement during an await", async () => {
    const adapter = new FakeAdapter();
    const observer = adapter.observer();
    const first = observer.reconcile();
    expect(observer.reconcile()).toBe(first);
    observer.close();
    expect((await first).reason).toBe("host-unavailable");
    expect(adapter.submitted).toHaveLength(0);
  });

  it("bounds a missing submit reply and never replays the expired attempt", async () => {
    const adapter = new FakeAdapter();
    adapter.mutateGrant = (grant) => ({ ...grant, deadlineAt: new Date(Date.now() + 40).toISOString() });
    adapter.submit = async (grant) => {
      adapter.submitted.push(grant);
      return new Promise<StartupAttempt>(() => { /* Simulate a lost helper with no terminal reply. */ });
    };
    const observer = adapter.observer();
    expect((await observer.reconcile()).state).toBe("outcome-unknown");
    expect((await observer.reconcile()).state).toBe("outcome-unknown");
    expect(adapter.submitted).toHaveLength(1);
  });
});
