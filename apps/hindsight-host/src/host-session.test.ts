import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CapabilityChallenge, type CapabilityResume } from "@taki/shared/host-approval";
import { CapabilityRespondParamsSchema } from "@taki/shared/host-control";
import type { HindsightTrustedInvocation } from "@taki/shared/hindsight-custody";
import { createCustodyHostSession } from "./host-session.ts";
import { invocationFixture, preparedFixture } from "./custody-test-fixtures.ts";

const sessions: ReturnType<typeof createCustodyHostSession>[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.close(); vi.useRealTimers(); });
function fixture(posture: "ask" | "auto" = "auto") {
  const invocation = invocationFixture(posture); const frames: Array<{ method: string; params: unknown }> = [];
  const prepare = vi.fn(async (request: HindsightTrustedInvocation) => preparedFixture(request));
  const session = createCustodyHostSession({ owner: invocation.owner,
    identity: { hostId: invocation.control.targetHostId, connectionGeneration: 1, catalogGeneration: 1 }, prepare,
    send: async (method, params) => { frames.push({ method, params }); } });
  sessions.push(session);
  const request = { requestId: invocation.requestId, control: invocation.control, input: invocation.input };
  return { invocation, session, frames, prepare, request,
    challenge: () => frames.find((frame) => frame.method === "capability.challenge")!.params as CapabilityChallenge };
}
function resume(challenge: CapabilityChallenge, generation = challenge.control.approvalGeneration): CapabilityResume {
  return { requestId: challenge.requestId, challengeId: challenge.challengeId, control: challenge.control,
    authorization: { authorizationId: randomUUID(), approvalGeneration: generation, decisionScope: "once",
      controlDigest: challenge.controlDigest, challengeDigest: challenge.challengeDigest, decisionScopeDigest: challenge.decisionScopeDigest,
      issuedAt: new Date().toISOString(), expiresAt: challenge.control.deadlineAt } };
}
async function tick() { await Promise.resolve(); await Promise.resolve(); }

describe("release custody Host session", () => {
  it("auto waits for Core execute, binds one attempt and never reexecutes replayed frames", async () => {
    const h = fixture(); h.session.receive("capability.request", h.request);
    expect(h.prepare).not.toHaveBeenCalled();
    const execute = { requestId: h.request.requestId, control: h.request.control, challengeId: h.challenge().challengeId };
    h.session.receive("capability.execute", execute); await tick();
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(h.prepare.mock.calls[0]![0]).toMatchObject({ requestId: h.request.requestId, control: h.request.control });
    h.session.receive("capability.execute", execute); h.session.receive("capability.request", h.request);
    h.session.receive("capability.request", { ...h.request, requestId: randomUUID() }); await tick();
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(CapabilityRespondParamsSchema.parse(h.frames.find((frame) => frame.method === "capability.respond")!.params).state).toBe("completed");
  });

  it.each([1, 2])("ask accepts only a sealed one-use resume in allowed generation %i", async (generation) => {
    const h = fixture("ask"); h.session.receive("capability.request", h.request);
    expect(h.prepare).not.toHaveBeenCalled();
    h.session.receive("capability.resume", resume(h.challenge(), generation)); await tick();
    expect(h.prepare).toHaveBeenCalledTimes(1);
    const terminal = CapabilityRespondParamsSchema.parse(h.frames.at(-1)!.params);
    expect(terminal.authorization?.approvalGeneration).toBe(generation);
  });

  it.each(["generation", "scope", "digest", "input"])("refuses altered %s authorization without opening custody", async (kind) => {
    const h = fixture("ask"); h.session.receive("capability.request", h.request); const authorized = resume(h.challenge());
    if (kind === "generation") authorized.authorization.approvalGeneration = 3;
    if (kind === "scope") authorized.authorization.decisionScope = "always";
    if (kind === "digest") authorized.authorization.challengeDigest = "f".repeat(64);
    if (kind === "input") authorized.control = { ...authorized.control, inputDigest: "e".repeat(64) };
    h.session.receive("capability.resume", authorized); await tick(); expect(h.prepare).not.toHaveBeenCalled();
  });

  it("cancel aborts an in-flight read and suppresses its late prepared output", async () => {
    const h = fixture(); let finish!: () => void;
    h.prepare.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(preparedFixture(h.invocation)); }));
    h.session.receive("capability.request", h.request);
    h.session.receive("capability.execute", { requestId: h.request.requestId, control: h.request.control, challengeId: h.challenge().challengeId });
    h.session.receive("capability.cancel", { requestId: h.request.requestId, control: h.request.control, reason: "caller_cancelled" });
    finish(); await tick();
    expect(h.frames.filter((frame) => frame.method === "capability.respond").map((frame) => CapabilityRespondParamsSchema.parse(frame.params).state)).toEqual(["cancelled"]);
  });

  it("a disconnected generation never emits a completed result or replays its old request", async () => {
    const h = fixture(); let finish!: () => void;
    h.prepare.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve(preparedFixture(h.invocation)); }));
    h.session.receive("capability.request", h.request);
    h.session.receive("capability.execute", { requestId: h.request.requestId, control: h.request.control, challengeId: h.challenge().challengeId });
    h.session.close(); finish(); await tick(); h.session.receive("capability.request", h.request);
    expect(h.frames.some((frame) => frame.method === "capability.respond")).toBe(false);
    expect(h.prepare).toHaveBeenCalledTimes(1);
  });

  it("changed policy retires old work and expired controls never reach custody", async () => {
    const h = fixture(); h.session.receive("capability.request", h.request); const challenge = h.challenge();
    h.session.receive("capability.request", { ...h.request, requestId: randomUUID(), control: { ...h.request.control, attemptId: randomUUID(), policyGeneration: 2 } });
    h.session.receive("capability.execute", { requestId: h.request.requestId, control: h.request.control, challengeId: challenge.challengeId });
    expect(h.prepare).not.toHaveBeenCalled();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 120_000));
    h.session.receive("capability.request", h.request); await tick(); expect(h.prepare).not.toHaveBeenCalled();
  });
});
