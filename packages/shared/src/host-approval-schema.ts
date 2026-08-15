/**
 * INPUT:  immutable Host controls plus trusted Host classification and Core-minted authorization candidates
 * OUTPUT: strict challenge/resume schemas and canonical digest payload serializers
 * POS:    shared/protocol — Host Approval extension; authority is nested without changing HostOperationControl
 */
import { z } from "zod";
import { ApprovalPresentationSchema, type ApprovalPresentation } from "./approval-schema.ts";
import {
  HostGovernanceEvidenceSchema,
  HostOperationControlSchema,
  PositiveGenerationSchema,
  Sha256HexSchema,
  type HostOperationControl,
} from "./host-control-schema.ts";

const TimestampSchema = z.iso.datetime({ offset: true });
export const HostChallengePresentationSchema = ApprovalPresentationSchema;
export type HostChallengePresentation = ApprovalPresentation;

export const CapabilityAuthorizationSchema = z.strictObject({
  authorizationId: z.uuid(),
  approvalGeneration: PositiveGenerationSchema,
  decisionScope: z.enum(["once", "session", "always"]),
  controlDigest: Sha256HexSchema,
  challengeDigest: Sha256HexSchema,
  decisionScopeDigest: Sha256HexSchema,
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
}).refine((value) => Date.parse(value.issuedAt) < Date.parse(value.expiresAt), {
  message: "authorization expiry must follow issue time",
  path: ["expiresAt"],
});
export type CapabilityAuthorization = z.infer<typeof CapabilityAuthorizationSchema>;

export const CapabilityChallengeSchema = z.strictObject({
  requestId: z.uuid(),
  control: HostOperationControlSchema,
  challengeId: z.uuid(),
  controlDigest: Sha256HexSchema,
  challengeDigest: Sha256HexSchema,
  decisionScopeDigest: Sha256HexSchema,
  governance: HostGovernanceEvidenceSchema,
  presentation: HostChallengePresentationSchema,
});
export type CapabilityChallenge = z.infer<typeof CapabilityChallengeSchema>;

export const CapabilityResumeSchema = z.strictObject({
  requestId: z.uuid(),
  control: HostOperationControlSchema,
  challengeId: z.uuid(),
  authorization: CapabilityAuthorizationSchema,
});
export type CapabilityResume = z.infer<typeof CapabilityResumeSchema>;

export function canonicalHostOperationControl(control: HostOperationControl): string {
  const value = HostOperationControlSchema.parse(control);
  return JSON.stringify({
    domain: "taki.host.operation-control",
    revision: 1,
    control: {
      runId: value.runId,
      operationId: value.operationId,
      attemptId: value.attemptId,
      targetHostId: value.targetHostId,
      connectionGeneration: value.connectionGeneration,
      catalogGeneration: value.catalogGeneration,
      policyGeneration: value.policyGeneration,
      governanceProjection: value.governanceProjection,
      approvalGeneration: value.approvalGeneration,
      capabilityId: value.capabilityId,
      inputDigest: value.inputDigest,
      idempotencyKey: value.idempotencyKey,
      dispatchedAt: value.dispatchedAt,
      deadlineAt: value.deadlineAt,
      ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt }),
    },
  });
}

export function canonicalCapabilityChallenge(challenge: CapabilityChallenge): string {
  const value = CapabilityChallengeSchema.parse(challenge);
  return JSON.stringify({
    domain: "taki.host.capability-challenge",
    revision: 1,
    requestId: value.requestId,
    challengeId: value.challengeId,
    controlDigest: value.controlDigest,
    decisionScopeDigest: value.decisionScopeDigest,
    governance: value.governance,
    presentation: value.presentation,
  });
}
