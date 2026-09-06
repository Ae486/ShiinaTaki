import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APPROVAL_PRESENTATION_REVISION } from "./approval-decision-schema.ts";
import { reconstructApprovalCommand } from "./approval-schema.ts";
import {
  CapabilityChallengeSchema,
  CapabilityResumeSchema,
  canonicalCapabilityChallenge,
  canonicalHostOperationControl,
} from "./host-approval-schema.ts";

const CONTROL = {
  runId: "33333333-3333-4333-8333-333333333333",
  operationId: "44444444-4444-4444-8444-444444444444",
  attemptId: "55555555-5555-4555-8555-555555555555",
  targetHostId: "11111111-1111-4111-8111-111111111111",
  connectionGeneration: 1,
  catalogGeneration: 1,
  policyGeneration: 1,
  governanceProjection: {
    registryRevision: 1, descriptorRevision: 1, classifierRevision: 1,
    cells: [{ key: "screenshot", posture: "ask" as const }], digest: "a".repeat(64),
  },
  approvalGeneration: 7,
  capabilityId: "screenshot",
  inputDigest: "b".repeat(64),
  idempotencyKey: "66666666-6666-4666-8666-666666666666",
  dispatchedAt: "2026-08-12T00:00:00.000Z",
  deadlineAt: "2026-08-12T00:01:00.000Z",
};

const CHALLENGE = {
  requestId: "22222222-2222-4222-8222-222222222222",
  control: CONTROL,
  challengeId: "77777777-7777-4777-8777-777777777777",
  controlDigest: "c".repeat(64),
  challengeDigest: "d".repeat(64),
  decisionScopeDigest: "e".repeat(64),
  governance: {
    descriptorRevision: 1, classifierRevision: 1, cellKey: "screenshot",
    effectivePosture: "ask" as const, constraint: "none" as const,
  },
  presentation: {
    revision: 1 as const,
    title: "Allow Host capability",
    capabilityLabel: "screenshot",
    riskSummary: "The connected Execution Host classified this request as requiring Approval.",
    sections: [{ title: "Classification", fields: [{ label: "Cell", value: "screenshot" }] }],
  },
};

describe("Host Approval schemas", () => {
  it("keeps authority nested under resume and rejects loose or expired authorizations", () => {
    const authorization = {
      authorizationId: "88888888-8888-4888-8888-888888888888",
      approvalGeneration: 7,
      decisionScope: "once" as const,
      controlDigest: CHALLENGE.controlDigest,
      challengeDigest: CHALLENGE.challengeDigest,
      decisionScopeDigest: CHALLENGE.decisionScopeDigest,
      issuedAt: "2026-08-12T00:00:10.000Z",
      expiresAt: "2026-08-12T00:00:50.000Z",
    };
    expect(CapabilityChallengeSchema.parse(CHALLENGE)).toBeDefined();
    expect(CapabilityResumeSchema.parse({
      requestId: CHALLENGE.requestId, control: CONTROL, challengeId: CHALLENGE.challengeId, authorization,
    })).toBeDefined();
    expect(CapabilityResumeSchema.safeParse({ ...CHALLENGE, authorization }).success).toBe(false);
    expect(CapabilityResumeSchema.safeParse({
      requestId: CHALLENGE.requestId, control: CONTROL, challengeId: CHALLENGE.challengeId,
      authorization: { ...authorization, expiresAt: authorization.issuedAt },
    }).success).toBe(false);
  });

  it("pins fixed-order domain-separated control and challenge canonicalization", () => {
    const controlDigest = createHash("sha256").update(canonicalHostOperationControl(CONTROL)).digest("hex");
    const challenge = { ...CHALLENGE, controlDigest };
    const challengeDigest = createHash("sha256").update(canonicalCapabilityChallenge(challenge)).digest("hex");
    expect(controlDigest).toBe("c07a2ba3eb72bc8b068c2c388bfee0dc7c9d9a07d1c26ab52ac5573420ffe0e1");
    expect(challengeDigest).toBe("2ae3935fdee2150a2701f5c3730931753012e7dd833c8e2d3d903196d7dde97e");
    expect(canonicalCapabilityChallenge(challenge)).toContain("presentation");
    expect(canonicalCapabilityChallenge(challenge)).not.toContain("commandDisclosure");
    const reordered = Object.fromEntries(Object.entries(CONTROL).reverse());
    expect(canonicalHostOperationControl(reordered as typeof CONTROL)).toBe(canonicalHostOperationControl(CONTROL));
    expect(canonicalHostOperationControl({ ...CONTROL, approvalGeneration: 8 })).not.toBe(
      canonicalHostOperationControl(CONTROL),
    );
    expect(canonicalHostOperationControl({
      ...CONTROL,
      coreAttemptId: "99999999-9999-4999-8999-999999999999",
      effectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })).toBe(canonicalHostOperationControl(CONTROL));
    expect(canonicalCapabilityChallenge({
      ...challenge,
      presentation: { ...challenge.presentation, riskSummary: "A distinct bounded disclosure." },
    })).not.toBe(canonicalCapabilityChallenge(challenge));
    expect(canonicalCapabilityChallenge({
      ...challenge,
      governance: { ...challenge.governance, cellKey: "different-cell" },
    })).not.toBe(canonicalCapabilityChallenge(challenge));
    expect(canonicalCapabilityChallenge({
      ...challenge,
      decisionScopeDigest: "f".repeat(64),
    })).not.toBe(canonicalCapabilityChallenge(challenge));
    expect(challenge.presentation.revision).toBe(APPROVAL_PRESENTATION_REVISION);
  });

  it("pins the marked command golden bytes while every display/scope change invalidates the digest", () => {
    const fixture = CapabilityChallengeSchema.parse(JSON.parse(readFileSync(new URL(
      "../fixtures/protocol/capability-challenge.exec-disclosure.valid.json", import.meta.url,
    ), "utf8")));
    const digest = (value: typeof fixture) => createHash("sha256").update(canonicalCapabilityChallenge(value)).digest("hex");
    expect(createHash("sha256").update(canonicalHostOperationControl(fixture.control)).digest("hex"))
      .toBe("069b39b45514eec068fa71a4ea390e9ceba0d834beb9a1330af9f0483dd126c1");
    expect(digest(fixture)).toBe("e84382212f3ad083eacbc2d9a967e4e196109b83411e1a1361a862927debf209");
    expect(reconstructApprovalCommand(fixture.presentation))
      .toBe('curl -H "Authorization: Bearer [凭证已隐藏]" https://example.test/api');
    const mutations: Array<(value: typeof fixture) => void> = [
      (v) => { delete v.presentation.commandDisclosure; },
      (v) => { v.presentation.sections.reverse(); },
      (v) => { v.presentation.sections[0]!.fields.reverse(); },
      (v) => { v.presentation.sections[1]!.fields[0]!.value += " final-tail"; },
      (v) => { v.presentation.title += "?"; },
      (v) => { v.presentation.riskSummary += "!"; },
      (v) => { v.decisionScopeDigest = "f".repeat(64); },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(fixture);
      mutate(changed);
      expect(digest(changed)).not.toBe(fixture.challengeDigest);
    }
  });
});
