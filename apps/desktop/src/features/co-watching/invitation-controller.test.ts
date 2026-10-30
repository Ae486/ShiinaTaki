import { describe, expect, it, vi } from "vitest";
import type { CoWatchingChanged, CoWatchingControlResult, CoWatchingInvitationReadResult,
  CoWatchingInvitationRespondResult, CoWatchingReadResult } from "@taki/shared";
import type { ReadSubscriptionSupport } from "@/lib/ws-read-subscriptions.js";
import { INITIAL_INVITATION_STATE, InvitationController, type InvitationState } from "./invitation-controller.ts";

const INVITATION = { invitationId: "11111111-1111-4111-8111-111111111111", version: 0, characterId: "taki",
  media: { kind: "bilibili" as const, bvid: "BV1xx411c7mD", cid: "123", page: 1 }, title: "Example video",
  timelineSeq: 8, expiresAt: "2026-10-17T12:02:00.000Z" };
const READ: CoWatchingInvitationReadResult = { characterId: "taki", invitation: INVITATION };
const SESSION: CoWatchingReadResult = { characterId: "taki", enabled: true, sources: [], analyses: [], session: null };
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  let state = INITIAL_INVITATION_STATE; const states: InvitationState[] = [];
  const controller = new InvitationController("taki", (value) => { state = value; states.push(value); });
  const handlers = new Set<(event: CoWatchingChanged) => void>();
  const client = {
    coWatchingInvitationRead: vi.fn(async (): Promise<CoWatchingInvitationReadResult> => READ),
    coWatchingRead: vi.fn(async (): Promise<CoWatchingReadResult> => SESSION),
    coWatchingInvitationRespond: vi.fn(async (): Promise<CoWatchingInvitationRespondResult> => ({ status: "applied", action: "defer", session: null })),
    coWatchingStop: vi.fn(async (): Promise<CoWatchingControlResult> => ({ accepted: false, reason: "not_found" })),
    subscribeCoWatching: vi.fn(async (): Promise<ReadSubscriptionSupport> => "supported"),
    onCoWatchingChanged: vi.fn((handler: (event: CoWatchingChanged) => void) => { handlers.add(handler); return () => { handlers.delete(handler); }; }),
  };
  return { controller, client, state: () => state, states, change: (revision: number) => handlers.forEach((handler) => handler({ characterId: "taki", revision })) };
}

describe("contextual invitation controller", () => {
  it("subscribes before reads and performs no reads or rendering while hidden", async () => {
    const f = fixture(); const ready = deferred<ReadSubscriptionSupport>();
    f.client.subscribeCoWatching.mockImplementation(() => { expect(f.client.onCoWatchingChanged).toHaveBeenCalledOnce(); return ready.promise; });
    f.controller.replace(f.client); const reading = f.controller.refresh(); f.change(1);
    expect(f.client.coWatchingInvitationRead).not.toHaveBeenCalled(); ready.resolve("supported"); await reading;
    expect(f.state().invitation).toBe(INVITATION);
    f.controller.setVisible(false); const count = f.states.length;
    f.change(2); f.change(3); await flush(); expect(f.states).toHaveLength(count); expect(f.client.coWatchingInvitationRead).toHaveBeenCalledOnce();
    f.controller.setVisible(true); await f.controller.refresh(); expect(f.client.coWatchingInvitationRead).toHaveBeenCalledTimes(2);
  });
  it("sends the displayed invitation and revision, then reconciles a decline without replay", async () => {
    const f = fixture(); f.controller.replace(f.client); await f.controller.refresh();
    f.client.coWatchingInvitationRead.mockResolvedValue({ characterId: "taki", invitation: null });
    await f.controller.respond(INVITATION, "defer");
    expect(f.client.coWatchingInvitationRespond).toHaveBeenCalledWith({ characterId: "taki", invitationId: INVITATION.invitationId,
      expectedVersion: 0, commandId: expect.any(String), action: "defer" });
    expect(f.state()).toMatchObject({ invitation: null, pending: false, stale: false });
    await f.controller.respond(INVITATION, "accept"); expect(f.client.coWatchingInvitationRespond).toHaveBeenCalledOnce();
  });
  it("rejects stale review actions and serializes commands across hide/show", async () => {
    const f = fixture(); f.controller.replace(f.client); await f.controller.refresh();
    await f.controller.respond({ ...INVITATION, version: 1 }, "accept"); expect(f.client.coWatchingInvitationRespond).not.toHaveBeenCalled();
    const result = deferred<CoWatchingInvitationRespondResult>(); f.client.coWatchingInvitationRespond.mockReturnValueOnce(result.promise);
    const writing = f.controller.respond(INVITATION, "accept"); f.controller.setVisible(false); f.controller.setVisible(true);
    await f.controller.respond(INVITATION, "accept"); expect(f.client.coWatchingInvitationRespond).toHaveBeenCalledOnce();
    result.resolve({ status: "refused", reason: "stale" }); await writing;
    expect(f.state().commandError).toContain("已变化"); expect(f.state().pending).toBe(false);
  });
  it("retains unknown results after connection replacement and never sends them to the new client", async () => {
    const f = fixture(); f.controller.replace(f.client); await f.controller.refresh();
    const result = deferred<CoWatchingInvitationRespondResult>(); f.client.coWatchingInvitationRespond.mockReturnValueOnce(result.promise);
    const writing = f.controller.respond(INVITATION, "accept");
    const next = fixture(); f.controller.replace(next.client); await f.controller.refresh();
    result.resolve({ status: "applied", action: "accept", session: null }); await writing;
    expect(f.state().commandError).toContain("上次操作结果尚未确认"); expect(next.client.coWatchingInvitationRespond).not.toHaveBeenCalled();
  });
  it("exposes an action failure and refreshes state without an automatic retry", async () => {
    const f = fixture(); f.controller.replace(f.client); await f.controller.refresh();
    f.client.coWatchingInvitationRespond.mockRejectedValueOnce(new Error("connection lost"));
    await f.controller.respond(INVITATION, "accept"); await f.controller.refresh();
    expect(f.state().commandError).toContain("操作未确认"); expect(f.client.coWatchingInvitationRespond).toHaveBeenCalledOnce();
  });
});
