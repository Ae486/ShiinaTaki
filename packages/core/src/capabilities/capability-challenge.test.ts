import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ApprovalPresentation,
  CapabilityChallenge,
  CapabilityRequest,
  CapabilityResume,
  CanonicalApprovalRequest,
} from "@taki/shared";
import { canonicalCapabilityChallenge, canonicalHostOperationControl } from "@taki/shared";
import { approvalDecisionScopeDigest } from "../approval/approval-binding.ts";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { fakeOperator, testApproval } from "../testing/capability-tool-harness.ts";
import type { Connection } from "../server/connection-registry.ts";
import { TIMEOUT_MESSAGE, createCapabilityBroker, type CapabilityBroker } from "./capability-broker.ts";
import type { CapabilityDispatchTarget } from "./capability-broker-state.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const SENTINEL_INPUT = { secret: "SENTINEL-RAW-INPUT-9f1e" };
const PRESENTATION: ApprovalPresentation = {
  revision: 1,
  title: "Allow Host capability",
  capabilityLabel: "screenshot",
  riskSummary: "The connected Execution Host classified this request as requiring Approval.",
  sections: [{ title: "Classification", fields: [{ label: "Cell", value: "screenshot" }] }],
};
const ASK_EVIDENCE = { descriptorRevision: 1, classifierRevision: 1, cellKey: "screenshot", effectivePosture: "ask" as const, constraint: "none" as const };
const AUTO_EVIDENCE = { ...ASK_EVIDENCE, effectivePosture: "auto" as const };

interface Harness {
  broker: CapabilityBroker;
  approval: ApprovalInteractionService;
  operator: Connection;
  hostFrames: Map<string, unknown[]>;
  approvalRequests: CanonicalApprovalRequest[];
  records: unknown[];
}

function makeHarness(operatorNotify = true): Harness {
  const capture = createCaptureLogger();
  const approval = testApproval();
  const hostFrames = new Map<string, unknown[]>();
  const broker = createCapabilityBroker({
    logger: capture.logger,
    approval,
    now: () => Date.parse("2026-08-12T00:00:00.000Z"),
  });
  const approvalRequests: CanonicalApprovalRequest[] = [];
  const operator = fakeOperator(operatorNotify
    ? (_method, params) => (approvalRequests.push(params as CanonicalApprovalRequest))
    : undefined);
  return { broker, approval, operator, hostFrames, approvalRequests, records: capture.records as unknown[] };
}

function askTarget(harness: Harness): CapabilityDispatchTarget {
  return {
    hostId: HOST,
    connectionGeneration: 1,
    catalogGeneration: 1,
    descriptor: { capabilityId: "screenshot", execution: "read", cancellation: "cooperative", governance: { descriptorRevision: 1, classifierId: "fixed-risk", classifierRevision: 1 } },
    connection: fakeOperator(),
    notify: (method, params) => {
      harness.hostFrames.set(method, [...(harness.hostFrames.get(method) ?? []), params]);
    },
    policyGeneration: 1,
    governanceProjection: { registryRevision: 1, descriptorRevision: 1, classifierRevision: 1, cells: [{ key: "screenshot", posture: "ask" as const }], digest: "a".repeat(64) },
    operator: { connection: harness.operator },
    isCurrent: () => true,
  };
}

function challengeFor(request: CapabilityRequest): CapabilityChallenge {
  const scopeDigest = approvalDecisionScopeDigest({
    bindingRevision: 1,
    identity: { capabilityId: "screenshot", ownerHostId: HOST },
    descriptorRevision: 1,
    classifierId: "fixed-risk",
    classifierRevision: 1,
    cellKey: "screenshot",
  });
  const controlDigest = createHash("sha256").update(canonicalHostOperationControl(request.control), "utf8").digest("hex");
  const base = {
    requestId: request.requestId,
    control: request.control,
    challengeId: "77777777-7777-4777-8777-777777777777",
    controlDigest,
    decisionScopeDigest: scopeDigest,
    governance: ASK_EVIDENCE,
    presentation: PRESENTATION,
  };
  const challengeDigest = createHash("sha256").update(canonicalCapabilityChallenge({ ...base, challengeDigest: "0".repeat(64) } as CapabilityChallenge), "utf8").digest("hex");
  return { ...base, challengeDigest };
}

function sentRequest(harness: Harness): CapabilityRequest {
  const frames = harness.hostFrames.get("capability.request") ?? [];
  return frames.at(-1) as CapabilityRequest;
}

async function driveToChallenge(harness: Harness) {
  const pending = harness.broker.request(askTarget(harness), SENTINEL_INPUT);
  const request = sentRequest(harness);
  const ack = harness.broker.challenge(challengeFor(request), { hostId: HOST, connectionGeneration: 1 });
  return { pending, request, ack };
}

describe("capability challenge/resume", () => {
  it("bridges an ask challenge to the owning operator and resumes with a sealed single-use authorization", async () => {
    const harness = makeHarness();
    const { pending, request, ack } = await driveToChallenge(harness);
    expect(ack).toEqual({ accepted: true });
    expect(harness.approvalRequests).toHaveLength(1);
    expect(harness.approvalRequests[0]?.presentation).toEqual(PRESENTATION);

    const respond = harness.approval.respond(harness.operator, {
      approvalId: harness.approvalRequests[0]!.approvalId,
      choice: "allow_once",
      expectedApprovalGeneration: harness.approval.approvalGeneration(),
    });
    expect(respond.status).toBe("accepted");
    await Promise.resolve();
    const resume = (harness.hostFrames.get("capability.resume") ?? []).at(-1) as CapabilityResume;
    expect(resume.requestId).toBe(request.requestId);
    expect(resume.control).toEqual(request.control);
    expect(resume.authorization.approvalGeneration).toBe(1);
    expect(resume.authorization.controlDigest).toBe(challengeFor(request).controlDigest);

    expect(harness.broker.resolve({
      requestId: request.requestId,
      control: request.control,
      state: "completed",
      output: { ok: true },
      governance: ASK_EVIDENCE,
      authorization: {
        authorizationId: resume.authorization.authorizationId,
        approvalGeneration: resume.authorization.approvalGeneration,
        challengeDigest: resume.authorization.challengeDigest,
      },
    }, { hostId: HOST, connectionGeneration: 1 })).toEqual({ accepted: true });
    await expect(pending).resolves.toEqual({ ok: true, output: { ok: true } });
  });

  it("rejects a terminal frame whose authorization lineage does not match the minted authorization", async () => {
    const harness = makeHarness();
    const { pending, request } = await driveToChallenge(harness);
    harness.approval.respond(harness.operator, {
      approvalId: harness.approvalRequests[0]!.approvalId,
      choice: "allow_once",
      expectedApprovalGeneration: harness.approval.approvalGeneration(),
    });
    await Promise.resolve();
    const resume = (harness.hostFrames.get("capability.resume") ?? []).at(-1) as CapabilityResume;
    const tampered = {
      requestId: request.requestId,
      control: request.control,
      state: "completed" as const,
      output: {},
      governance: ASK_EVIDENCE,
      authorization: { ...resume.authorization, authorizationId: "99999999-9999-4999-8999-999999999999" },
    };
    expect(harness.broker.resolve(tampered, { hostId: HOST, connectionGeneration: 1 })).toEqual({ accepted: false, reason: "stale_generation" });
    expect(harness.broker.resolve({ ...tampered, authorization: undefined }, { hostId: HOST, connectionGeneration: 1 }))
      .toEqual({ accepted: false, reason: "stale_generation" });
    expect(harness.broker.resolve({
      requestId: request.requestId,
      control: request.control,
      state: "completed",
      output: {},
      governance: ASK_EVIDENCE,
      authorization: lineageOf(harness),
    }, { hostId: HOST, connectionGeneration: 1 })).toEqual({ accepted: true });
    await expect(pending).resolves.toEqual({ ok: true, output: {} });
  });

  it("rejects tampered or misattributed challenges and settles the attempt fail-closed", async () => {
    const harness = makeHarness();
    const pending = harness.broker.request(askTarget(harness), SENTINEL_INPUT);
    const request = sentRequest(harness);
    const challenge = challengeFor(request);

    expect(harness.broker.challenge(challenge, { hostId: "22222222-2222-4222-8222-222222222222", connectionGeneration: 1 }))
      .toEqual({ accepted: false, reason: "wrong_host" });
    expect(harness.broker.challenge(challenge, { hostId: HOST, connectionGeneration: 2 }))
      .toEqual({ accepted: false, reason: "stale_generation" });

    const tamperedDigest = { ...challenge, controlDigest: "f".repeat(64) } as CapabilityChallenge;
    expect(harness.broker.challenge(tamperedDigest, { hostId: HOST, connectionGeneration: 1 }))
      .toEqual({ accepted: false, reason: "stale_generation" });
    const cancels = harness.hostFrames.get("capability.cancel") ?? [];
    expect(cancels.at(-1)).toMatchObject({ reason: "approval_invalidated" });
    await expect(pending).resolves.toMatchObject({ ok: false, code: "NODE_DISCONNECTED" });
  });

  it("rejects an auto/deny-classified challenge and an unprojected evidence cell", async () => {
    for (const governance of [AUTO_EVIDENCE, { ...ASK_EVIDENCE, cellKey: "unknown-cell" }]) {
      const harness = makeHarness();
      const pending = harness.broker.request(askTarget(harness), SENTINEL_INPUT);
      const request = sentRequest(harness);
      expect(harness.broker.challenge({ ...challengeFor(request), governance }, { hostId: HOST, connectionGeneration: 1 }))
        .toEqual({ accepted: false, reason: "stale_generation" });
      await expect(pending).resolves.toMatchObject({ ok: false, code: "NODE_DISCONNECTED" });
      expect(harness.approvalRequests).toHaveLength(0);
    }
  });

  it("settles denied with a retirement cancel and never resumes", async () => {
    const harness = makeHarness();
    const { pending } = await driveToChallenge(harness);
    harness.approval.respond(harness.operator, {
      approvalId: harness.approvalRequests[0]!.approvalId,
      choice: "deny",
      expectedApprovalGeneration: harness.approval.approvalGeneration(),
    });
    await expect(pending).resolves.toEqual({ ok: false, code: "DENIED", message: "approval was not granted" });
    expect(harness.hostFrames.get("capability.resume")).toBeUndefined();
    expect((harness.hostFrames.get("capability.cancel") ?? []).at(-1)).toMatchObject({ reason: "approval_denied" });
  });

  it("fails closed without an ambient prompt when the turn carries no operator", async () => {
    const harness = makeHarness();
    const target = { ...askTarget(harness), operator: undefined };
    const pending = harness.broker.request(target, SENTINEL_INPUT);
    const request = sentRequest(harness);
    expect(harness.broker.challenge(challengeFor(request), { hostId: HOST, connectionGeneration: 1 }))
      .toEqual({ accepted: true });
    await expect(pending).resolves.toEqual({
      ok: false,
      code: "APPROVAL_REQUIRED",
      message: "approval requires an active operator connection",
    });
    expect(harness.approvalRequests).toHaveLength(0);
  });

  it("retires the pending challenge when the approval generation changes elsewhere", async () => {
    const harness = makeHarness();
    const { pending } = await driveToChallenge(harness);
    // A second operator interaction answering allow_session advances the global generation to 2.
    const secondApprovalId = openSecondInteraction(harness);
    harness.approval.respond(harness.operator, {
      approvalId: secondApprovalId,
      choice: "allow_session",
      expectedApprovalGeneration: harness.approval.approvalGeneration(),
    });
    await expect(pending).resolves.toMatchObject({ ok: false, code: "CANCELLED" });
    expect(harness.hostFrames.get("capability.resume")).toBeUndefined();
    expect((harness.hostFrames.get("capability.cancel") ?? []).at(-1)).toMatchObject({ reason: "approval_invalidated" });
  });

  it("retires the pending challenge when the dispatch policy is invalidated", async () => {
    const harness = makeHarness();
    const { pending } = await driveToChallenge(harness);
    harness.approval.invalidatePolicy(2);
    await expect(pending).resolves.toMatchObject({ ok: false, code: "CANCELLED" });
    expect(harness.hostFrames.get("capability.resume")).toBeUndefined();
  });

  it("expires an unanswered challenge with the bounded deadline outcome", async () => {
    vi.useFakeTimers();
    try {
      const capture = createCaptureLogger();
      const approval = testApproval();
      const hostFrames = new Map<string, unknown[]>();
      const operator = fakeOperator(() => undefined);
      const broker = createCapabilityBroker({ logger: capture.logger, approval, timeoutMs: 100, now: Date.now });
      const pending = broker.request({ ...askTarget({ broker, approval, operator, hostFrames, approvalRequests: [], records: [] }), operator: { connection: operator } }, SENTINEL_INPUT);
      const request = (hostFrames.get("capability.request") ?? []).at(-1) as CapabilityRequest;
      broker.challenge(challengeFor(request), { hostId: HOST, connectionGeneration: 1 });
      await vi.advanceTimersByTimeAsync(100);
      await expect(pending).resolves.toEqual({ ok: false, code: "CAPABILITY_TIMEOUT", message: TIMEOUT_MESSAGE });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps raw capability input out of every broker log line", async () => {
    const harness = makeHarness();
    const { pending, request } = await driveToChallenge(harness);
    harness.approval.respond(harness.operator, {
      approvalId: harness.approvalRequests[0]!.approvalId,
      choice: "allow_once",
      expectedApprovalGeneration: harness.approval.approvalGeneration(),
    });
    await Promise.resolve();
    harness.broker.resolve({
      requestId: request.requestId,
      control: request.control,
      state: "completed",
      output: {},
      governance: ASK_EVIDENCE,
      authorization: lineageOf(harness),
    }, { hostId: HOST, connectionGeneration: 1 });
    await pending;
    for (const record of harness.records) {
      expect(JSON.stringify(record)).not.toContain("SENTINEL-RAW-INPUT");
    }
    const cancelFrames = JSON.stringify([...(harness.hostFrames.get("capability.cancel") ?? [])]);
    expect(cancelFrames).not.toContain("SENTINEL-RAW-INPUT");
  });
});

function lineageOf(harness: Harness) {
  const resume = (harness.hostFrames.get("capability.resume") ?? []).at(-1) as CapabilityResume;
  return {
    authorizationId: resume.authorization.authorizationId,
    approvalGeneration: resume.authorization.approvalGeneration,
    challengeDigest: resume.authorization.challengeDigest,
  };
}

function openSecondInteraction(harness: Harness): string {
  const before = harness.approvalRequests.length;
  harness.approval.request({
    owner: harness.operator,
    policyGeneration: 1,
    binding: {
      bindingRevision: 1,
      identity: { capabilityId: "clipboard-read", ownerHostId: HOST },
      descriptorRevision: 1,
      classifierId: "fixed-risk",
      classifierRevision: 1,
      cellKey: "clipboard-read",
      decisionScopeDigest: approvalDecisionScopeDigest({
        bindingRevision: 1,
        identity: { capabilityId: "clipboard-read", ownerHostId: HOST },
        descriptorRevision: 1,
        classifierId: "fixed-risk",
        classifierRevision: 1,
        cellKey: "clipboard-read",
      }),
    },
    presentation: PRESENTATION,
  });
  return harness.approvalRequests[before]!.approvalId;
}
