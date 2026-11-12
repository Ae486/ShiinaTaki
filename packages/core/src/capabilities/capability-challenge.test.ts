import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ApprovalPresentation,
  CapabilityChallenge,
  CapabilityRequest,
  CapabilityResume,
  CanonicalApprovalRequest,
  HostGovernanceEvidence,
} from "@taki/shared";
import { canonicalCapabilityChallenge, canonicalHostOperationControl, reconstructApprovalCommand } from "@taki/shared";
import { approvalDecisionScopeDigest } from "../approval/approval-binding.ts";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { fakeOperator, testApproval } from "../testing/capability-tool-harness.ts";
import type { Connection } from "../server/connection-registry.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
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

function makeHarness(operatorNotify = true, effects?: EffectLifecycleService): Harness {
  const capture = createCaptureLogger();
  const approval = testApproval();
  const hostFrames = new Map<string, unknown[]>();
  const broker = createCapabilityBroker({
    logger: capture.logger,
    approval,
    now: () => Date.parse("2026-08-12T00:00:00.000Z"),
    effects,
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

function challengeFor(request: CapabilityRequest, governance: HostGovernanceEvidence = ASK_EVIDENCE): CapabilityChallenge {
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
    governance,
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
  it("retains unknown outcome when an unattended non-cooperative effect is cancelled after execute", async () => {
    const order: string[] = [];
    const effects = effectService(order);
    const settle = vi.spyOn(effects, "settle");
    const harness = makeHarness(false, effects);
    const controller = new AbortController();
    const target = askTarget(harness);
    target.operator = undefined; target.signal = controller.signal;
    target.descriptor = { ...target.descriptor, execution: "effect", cancellation: "non-cooperative" };
    target.governanceProjection = { ...target.governanceProjection, cells: [{ key: "screenshot", posture: "auto" }] };
    const pending = harness.broker.request(target, {}, {
      runId: "22222222-2222-4222-8222-222222222222", coreAttemptId: "33333333-3333-4333-8333-333333333333" });
    const request = sentRequest(harness);
    expect(harness.broker.challenge(challengeFor(request, AUTO_EVIDENCE), { hostId: HOST, connectionGeneration: 1 })).toEqual({ accepted: true });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, code: "OUTCOME_UNKNOWN", state: "outcome_unknown" });
    expect(settle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: "outcome_unknown" }));
    expect(harness.hostFrames.get("capability.cancel")).toBeUndefined();
    expect(harness.approvalRequests).toEqual([]);
  });

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
    await expect(pending).resolves.toMatchObject({ ok: false, code: "CANCELLED", state: "cancelled" });
  });

  it("rejects an unprojected evidence cell", async () => {
    for (const governance of [{ ...ASK_EVIDENCE, cellKey: "unknown-cell" }]) {
      const harness = makeHarness();
      const pending = harness.broker.request(askTarget(harness), SENTINEL_INPUT);
      const request = sentRequest(harness);
      expect(harness.broker.challenge({ ...challengeFor(request), governance }, { hostId: HOST, connectionGeneration: 1 }))
        .toEqual({ accepted: false, reason: "stale_generation" });
      await expect(pending).resolves.toMatchObject({ ok: false, code: "CANCELLED", state: "cancelled" });
      expect(harness.approvalRequests).toHaveLength(0);
    }
  });

  it("commits the Host Effect only after auto preflight and before explicit execute", async () => {
    const order: string[] = [];
    const effects = effectService(order);
    const harness = makeHarness(true, effects);
    const target = askTarget(harness);
    target.governanceProjection = { ...target.governanceProjection, cells: [{ key: "screenshot", posture: "auto" }] };
    target.notify = (method, params) => {
      order.push(method);
      harness.hostFrames.set(method, [...(harness.hostFrames.get(method) ?? []), params]);
    };
    const pending = harness.broker.request(target, SENTINEL_INPUT, {
      runId: "22222222-2222-4222-8222-222222222222",
      coreAttemptId: "33333333-3333-4333-8333-333333333333",
    });
    const request = sentRequest(harness);
    expect(request.control.effectId).toBeDefined();
    expect(order).toEqual(["capability.request"]);

    expect(harness.broker.challenge(challengeFor(request, AUTO_EVIDENCE), { hostId: HOST, connectionGeneration: 1 }))
      .toEqual({ accepted: true });
    expect(order).toEqual(["capability.request", "effect.prepare", "capability.execute"]);
    harness.broker.resolve({
      requestId: request.requestId,
      control: request.control,
      state: "completed",
      output: { ok: true },
      governance: AUTO_EVIDENCE,
    }, { hostId: HOST, connectionGeneration: 1 });
    await expect(pending).resolves.toEqual({ ok: true, output: { ok: true } });
    expect(order).toEqual(["capability.request", "effect.prepare", "capability.execute", "effect.settle"]);
  });

  it("persists Host Approval waiting before prompt settlement and commits intent before resume", async () => {
    const order: string[] = [];
    const effects = effectService(order);
    const harness = makeHarness(true, effects);
    const target = askTarget(harness);
    target.notify = (method, params) => {
      order.push(method);
      harness.hostFrames.set(method, [...(harness.hostFrames.get(method) ?? []), params]);
    };
    const pending = harness.broker.request(target, SENTINEL_INPUT, {
      runId: "22222222-2222-4222-8222-222222222222",
      coreAttemptId: "33333333-3333-4333-8333-333333333333",
    });
    const request = sentRequest(harness);
    harness.broker.challenge(challengeFor(request), { hostId: HOST, connectionGeneration: 1 });
    expect(order).toEqual(["capability.request", "effect.waiting"]);

    harness.approval.respond(harness.operator, {
      approvalId: harness.approvalRequests[0]!.approvalId,
      choice: "allow_once",
      expectedApprovalGeneration: 1,
    });
    await Promise.resolve();
    expect(order).toEqual(["capability.request", "effect.waiting", "effect.commit", "capability.resume"]);
    const resume = (harness.hostFrames.get("capability.resume") ?? []).at(-1) as CapabilityResume;
    harness.broker.resolve({
      requestId: request.requestId,
      control: request.control,
      state: "completed",
      output: {},
      governance: ASK_EVIDENCE,
      authorization: {
        authorizationId: resume.authorization.authorizationId,
        approvalGeneration: resume.authorization.approvalGeneration,
        challengeDigest: resume.authorization.challengeDigest,
      },
    }, { hostId: HOST, connectionGeneration: 1 });
    await pending;
    expect(order.at(-1)).toBe("effect.settle");
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

  it("settles a denied Host Approval wait without committing target intent", async () => {
    const order: string[] = [];
    const harness = makeHarness(true, effectService(order));
    const target = askTarget(harness);
    target.notify = (method, params) => {
      order.push(method);
      harness.hostFrames.set(method, [...(harness.hostFrames.get(method) ?? []), params]);
    };
    const pending = harness.broker.request(target, SENTINEL_INPUT, {
      runId: "22222222-2222-4222-8222-222222222222",
      coreAttemptId: "33333333-3333-4333-8333-333333333333",
    });
    const request = sentRequest(harness);
    harness.broker.challenge(challengeFor(request), { hostId: HOST, connectionGeneration: 1 });
    harness.approval.respond(harness.operator, {
      approvalId: harness.approvalRequests[0]!.approvalId,
      choice: "deny",
      expectedApprovalGeneration: 1,
    });
    await pending;
    expect(order).toContain("effect.settle-waiting");
    expect(order).not.toContain("effect.commit");
    expect(order).not.toContain("capability.resume");
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

  it("retires a non-cooperative effect challenge on deadline before any effect starts", async () => {
    vi.useFakeTimers();
    try {
      const capture = createCaptureLogger();
      const approval = testApproval();
      const hostFrames = new Map<string, unknown[]>();
      const operator = fakeOperator(() => undefined);
      const broker = createCapabilityBroker({ logger: capture.logger, approval, timeoutMs: 100, now: Date.now });
      const harness = { broker, approval, operator, hostFrames, approvalRequests: [], records: [] } satisfies Harness;
      const target = askTarget(harness);
      target.descriptor = { ...target.descriptor, execution: "effect", cancellation: "non-cooperative" };
      const pending = broker.request(target, SENTINEL_INPUT);
      const request = sentRequest(harness);
      expect(broker.challenge(challengeFor(request), { hostId: HOST, connectionGeneration: 1 }))
        .toEqual({ accepted: true });

      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toEqual({ ok: false, code: "CAPABILITY_TIMEOUT", message: TIMEOUT_MESSAGE });
      expect((hostFrames.get("capability.cancel") ?? []).at(-1)).toMatchObject({
        requestId: request.requestId,
        reason: "deadline_exceeded",
      });
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

const EXEC_PRESENTATION: ApprovalPresentation = {
  revision: 1, title: "允许执行此命令？", capabilityLabel: "执行命令", riskSummary: "已隐藏识别到的凭证。",
  sections: [{ title: "完整命令", fields: [{ label: "命令", value: "whoami --token=[凭证已隐藏] " }, { label: "命令", value: "完整尾部" }] }],
  commandDisclosure: { revision: 1, complete: true, encoding: "visible-escapes", reconstruction: "section-field-concat" },
};

function execTarget(harness: Harness, support = true): CapabilityDispatchTarget {
  if (support && harness.operator.state.status === "authenticated") {
    harness.operator.state = { ...harness.operator.state, approvalCommandDisclosureRevision: 1 };
  }
  const base = askTarget(harness);
  return { ...base,
    descriptor: { capabilityId: "exec", execution: "effect", cancellation: "non-cooperative", governance: { descriptorRevision: 1, classifierId: "exec-command", classifierRevision: 1 } },
    governanceProjection: { ...base.governanceProjection, cells: [{ key: "exec:allowlist-miss", posture: "ask" }] },
  };
}

function execChallenge(request: CapabilityRequest, presentation = EXEC_PRESENTATION): CapabilityChallenge {
  const base = challengeFor(request);
  const challenge: CapabilityChallenge = { ...base, presentation,
    governance: { ...ASK_EVIDENCE, cellKey: "exec:allowlist-miss" },
    decisionScopeDigest: approvalDecisionScopeDigest({ bindingRevision: 1,
      identity: { capabilityId: "exec", ownerHostId: HOST }, descriptorRevision: 1,
      classifierId: "exec-command", classifierRevision: 1, cellKey: "exec:allowlist-miss" }),
  };
  challenge.challengeDigest = createHash("sha256").update(canonicalCapabilityChallenge(challenge)).digest("hex");
  return challenge;
}

describe("exec complete-disclosure compatibility", () => {
  it.each(["host", "operator"])("immediately denies an old %s before Approval, intent or resume", async (legacy) => {
    const order: string[] = [];
    const h = makeHarness(true, effectService(order));
    const pending = h.broker.request(execTarget(h, legacy !== "operator"), { command: "RAW_CREDENTIAL_SENTINEL" });
    const presentation = legacy === "host" ? PRESENTATION : EXEC_PRESENTATION;
    const request = sentRequest(h);
    expect(h.broker.challenge(execChallenge(request, presentation), { hostId: HOST, connectionGeneration: 1 }))
      .toEqual({ accepted: false, reason: "unsupported_version" });
    await expect(pending).resolves.toMatchObject({ ok: false, code: "DENIED", message: expect.stringContaining("版本不支持完整命令审批") });
    expect(h.approvalRequests).toHaveLength(0);
    expect(order).toEqual([]);
    expect(h.hostFrames.get("capability.resume")).toBeUndefined();
    expect(h.hostFrames.get("capability.execute")).toBeUndefined();
    expect(h.hostFrames.get("capability.cancel")).toHaveLength(1);
    expect(JSON.stringify(h.records)).not.toContain("RAW_CREDENTIAL_SENTINEL");
  });

  it("preserves no-operator APPROVAL_REQUIRED even for a legacy Host presentation", async () => {
    const h = makeHarness(false);
    const pending = h.broker.request({ ...execTarget(h), operator: undefined }, SENTINEL_INPUT);
    h.broker.challenge(execChallenge(sentRequest(h), PRESENTATION), { hostId: HOST, connectionGeneration: 1 });
    await expect(pending).resolves.toMatchObject({ ok: false, code: "APPROVAL_REQUIRED" });
    expect(h.approvalRequests).toHaveLength(0);
  });

  it("validates provenance before applying compatibility refusal", async () => {
    const h = makeHarness();
    const pending = h.broker.request(execTarget(h), SENTINEL_INPUT);
    const request = sentRequest(h);
    expect(h.broker.challenge(execChallenge(request, PRESENTATION), { hostId: "foreign", connectionGeneration: 1 }))
      .toEqual({ accepted: false, reason: "wrong_host" });
    expect(h.hostFrames.get("capability.cancel")).toBeUndefined();
    h.broker.challenge(execChallenge(request, PRESENTATION), { hostId: HOST, connectionGeneration: 1 });
    await expect(pending).resolves.toMatchObject({ code: "DENIED" });
  });

  it("forwards the sealed complete command unchanged and resumes exactly once after allow", async () => {
    const h = makeHarness();
    const pending = h.broker.request(execTarget(h), { command: "RAW_CREDENTIAL_SENTINEL" });
    const request = sentRequest(h);
    const challenge = execChallenge(request);
    expect(h.broker.challenge(challenge, { hostId: HOST, connectionGeneration: 1 })).toEqual({ accepted: true });
    expect(h.approvalRequests).toHaveLength(1);
    expect(h.approvalRequests[0]!.presentation).toEqual(EXEC_PRESENTATION);
    expect(reconstructApprovalCommand(h.approvalRequests[0]!.presentation)).toBe("whoami --token=[凭证已隐藏] 完整尾部");
    const response = { approvalId: h.approvalRequests[0]!.approvalId, choice: "allow_once" as const, expectedApprovalGeneration: 1 };
    expect(h.approval.respond(h.operator, response).status).toBe("accepted");
    expect(h.approval.respond(h.operator, response).status).toBe("late");
    await Promise.resolve();
    expect(h.hostFrames.get("capability.resume")).toHaveLength(1);
    const terminal = { requestId: request.requestId, control: request.control, state: "completed" as const,
      output: {}, governance: challenge.governance, authorization: lineageOf(h) };
    expect(h.broker.resolve(terminal, { hostId: HOST, connectionGeneration: 1 })).toEqual({ accepted: true });
    await expect(pending).resolves.toEqual({ ok: true, output: {} });
    expect(JSON.stringify(h.records)).not.toContain("RAW_CREDENTIAL_SENTINEL");
  });

  it("accepts an immediate Host disclosure failure with exact ask evidence and no authorization", async () => {
    const h = makeHarness();
    const pending = h.broker.request(execTarget(h), SENTINEL_INPUT);
    const request = sentRequest(h);
    const failed = { requestId: request.requestId, control: request.control, state: "failed" as const,
      error: { code: "DENIED" as const, message: "无法完整、安全地展示此命令审批，已拒绝执行。" },
      governance: { ...ASK_EVIDENCE, cellKey: "exec:allowlist-miss" } };
    expect(h.broker.resolve({ ...failed, control: { ...request.control, inputDigest: "f".repeat(64) } }, { hostId: HOST, connectionGeneration: 1 }))
      .toEqual({ accepted: false, reason: "stale_generation" });
    expect(h.broker.resolve(failed, { hostId: HOST, connectionGeneration: 1 })).toEqual({ accepted: true });
    await expect(pending).resolves.toMatchObject({ ok: false, code: "DENIED" });
    expect(h.approvalRequests).toHaveLength(0);
    expect(h.hostFrames.get("capability.resume")).toBeUndefined();
  });
});

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

function effectService(order: string[]): EffectLifecycleService {
  const base = {
    schemaVersion: "effect.v1" as const,
    effectId: "88888888-8888-4888-8888-888888888888",
    runId: "22222222-2222-4222-8222-222222222222",
    attemptId: "33333333-3333-4333-8333-333333333333",
    kind: "host" as const,
    sourceRef: { type: "host" as const, operationId: "operation" },
    replayPosture: "safe" as const,
  };
  return {
    prepare: (input) => {
      order.push("effect.prepare");
      return { ...base, ...input, state: "intent_committed", version: 0 };
    },
    prepareWaiting: (input) => {
      order.push("effect.waiting");
      return { ...base, ...input, state: "waiting", version: 0 };
    },
    commitIntent: (input) => {
      order.push("effect.commit");
      return { effect: { ...base, effectId: input.effectId, state: "intent_committed", version: 1 }, stale: false, duplicate: false };
    },
    settleWaiting: (input) => {
      order.push("effect.settle-waiting");
      return { effect: { ...base, effectId: input.effectId, state: "terminal", version: input.expectedVersion + 1, outcome: input.outcome }, stale: false, duplicate: false };
    },
    settle: (input) => {
      order.push("effect.settle");
      return { effect: { ...base, effectId: input.effectId, state: "terminal", version: input.expectedVersion + 1, outcome: input.outcome }, stale: false, duplicate: false };
    },
    get: () => undefined,
    unfinished: () => [],
  };
}

describe("code-owned broker custody observers", () => {
  it("does not notify the Host if the original issued mapping cannot be recorded", async () => {
    const harness = makeHarness(); const target = askTarget(harness); const notify = vi.fn(); target.notify = notify;
    const accepted = vi.fn();
    const outcome = await harness.broker.request(target, {}, { observers: {
      onIssued: () => { throw new Error("mapping persistence refused"); }, onAccepted: accepted,
    } });
    expect(outcome).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(notify).not.toHaveBeenCalled(); expect(accepted).not.toHaveBeenCalled();
  });

  it("uses final Effect settlement rather than protocol accepted:true before notifying the custody owner", async () => {
    const order: string[] = []; const effects = effectService(order);
    effects.settle = () => { order.push("effect.downgrade"); return { stale: true, duplicate: false }; };
    const harness = makeHarness(true, effects); const target = askTarget(harness);
    target.governanceProjection.cells[0]!.posture = "auto";
    const accepted = vi.fn(); const issued = vi.fn();
    const pending = harness.broker.request(target, {}, { coreAttemptId: "33333333-3333-4333-8333-333333333333",
      effectId: "88888888-8888-4888-8888-888888888888", observers: { onIssued: issued, onAccepted: accepted } });
    const request = sentRequest(harness);
    expect(issued).toHaveBeenCalledTimes(1);
    expect(harness.broker.challenge(challengeFor(request, AUTO_EVIDENCE), { hostId: HOST, connectionGeneration: 1 }).accepted).toBe(true);
    expect(order).toContain("effect.prepare");
    expect(harness.broker.resolve({ requestId: request.requestId, control: request.control, state: "completed", output: {}, governance: AUTO_EVIDENCE },
      { hostId: HOST, connectionGeneration: 1 }).accepted).toBe(true);
    expect(await pending).toMatchObject({ ok: false, code: "CANCELLED" });
    expect(order).toContain("effect.downgrade"); expect(accepted).not.toHaveBeenCalled();
  });
});
