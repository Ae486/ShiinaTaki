/**
 * INPUT:  current paired Host session, sealed controls and the one implemented C1 capability
 * OUTPUT: trusted fixed-slot classification, canonical challenges and exact one-use authorization checks
 * POS:    hindsight-host — release Host final gate; a Node token never grants auto or approves an ask
 */
import { randomUUID } from "node:crypto";
import { canonicalCapabilityInput } from "@taki/shared/host-input";
import { canonicalHostGovernanceProjection, type CapabilityRequest, type HostGovernanceEvidence } from "@taki/shared/host-control";
import {
  canonicalCapabilityChallenge, canonicalHostOperationControl,
  type CapabilityChallenge, type CapabilityResume,
} from "@taki/shared/host-approval";
import { APPROVAL_BINDING_REVISION, canonicalApprovalDecisionScope } from "@taki/shared/approval-decision";
import { GOVERNANCE_REGISTRY_REVISION } from "@taki/shared/governance";
import { HINDSIGHT_CUSTODY_CAPABILITY, HINDSIGHT_CUSTODY_CELL, HindsightCustodyPrepareSchema } from "@taki/shared/hindsight-custody";
import { sha256 } from "./installed-files.ts";
import { CustodyError } from "./custody-error.ts";

export const CUSTODY_DESCRIPTOR = {
  capabilityId: HINDSIGHT_CUSTODY_CAPABILITY, execution: "read", cancellation: "cooperative",
  governance: { descriptorRevision: 1, classifierId: "hindsight-fixed-custody", classifierRevision: 1 },
} as const;
export interface HostGateIdentity { hostId: string; connectionGeneration: number; catalogGeneration: number }

export function classifyCustody(request: CapabilityRequest, identity: HostGateIdentity): HostGovernanceEvidence {
  const control = request.control;
  const projection = control.governanceProjection;
  if (control.targetHostId !== identity.hostId || control.connectionGeneration !== identity.connectionGeneration
    || control.catalogGeneration !== identity.catalogGeneration || control.capabilityId !== HINDSIGHT_CUSTODY_CAPABILITY
    || projection.registryRevision !== GOVERNANCE_REGISTRY_REVISION || projection.descriptorRevision !== 1
    || projection.classifierRevision !== 1 || projection.cells.length !== 1
    || projection.cells[0]?.key !== HINDSIGHT_CUSTODY_CELL
    || sha256(canonicalHostGovernanceProjection({ registryRevision: projection.registryRevision,
      descriptorRevision: projection.descriptorRevision, classifierRevision: projection.classifierRevision, cells: projection.cells })) !== projection.digest
    || sha256(canonicalCapabilityInput(control.capabilityId, request.input)) !== control.inputDigest
    || Date.now() >= Date.parse(control.deadlineAt)
    || (control.expiresAt !== undefined && Date.now() >= Date.parse(control.expiresAt))) throw new CustodyError("snapshot-stale");
  if (!HindsightCustodyPrepareSchema.safeParse(request.input).success) throw new CustodyError("input-oversize");
  return {
    descriptorRevision: 1, classifierRevision: 1, cellKey: HINDSIGHT_CUSTODY_CELL,
    effectivePosture: projection.cells[0].posture, constraint: "none",
  };
}

export function custodyChallenge(request: CapabilityRequest, governance: HostGovernanceEvidence): CapabilityChallenge {
  const controlDigest = sha256(canonicalHostOperationControl(request.control));
  const decisionScopeDigest = sha256(canonicalApprovalDecisionScope({
    bindingRevision: APPROVAL_BINDING_REVISION,
    identity: { capabilityId: HINDSIGHT_CUSTODY_CAPABILITY, ownerHostId: request.control.targetHostId },
    descriptorRevision: 1, classifierId: CUSTODY_DESCRIPTOR.governance.classifierId,
    classifierRevision: 1, cellKey: HINDSIGHT_CUSTODY_CELL,
  }));
  const challenge: CapabilityChallenge = {
    requestId: request.requestId, control: request.control, challengeId: randomUUID(),
    controlDigest, decisionScopeDigest, challengeDigest: "0".repeat(64), governance,
    presentation: {
      revision: 1, title: "Prepare Hindsight credential custody", capabilityLabel: "Hindsight custody",
      riskSummary: "Read the admitted local encrypted credential slots into transient Host memory.",
      sections: [{ title: "Effect", fields: [{ label: "Scope", value: "Credential preparation only; no Native deployment or model calls." }] }],
    },
  };
  challenge.challengeDigest = sha256(canonicalCapabilityChallenge(challenge));
  return challenge;
}

export function requireResume(challenge: CapabilityChallenge, resume: CapabilityResume): void {
  const authorization = resume.authorization;
  if (resume.requestId !== challenge.requestId || resume.challengeId !== challenge.challengeId
    || JSON.stringify(resume.control) !== JSON.stringify(challenge.control)
    || authorization.controlDigest !== challenge.controlDigest || authorization.challengeDigest !== challenge.challengeDigest
    || authorization.decisionScopeDigest !== challenge.decisionScopeDigest
    || authorization.decisionScope !== "once"
    || (authorization.approvalGeneration !== challenge.control.approvalGeneration
      && authorization.approvalGeneration !== challenge.control.approvalGeneration + 1)
    || Date.parse(authorization.issuedAt) < Date.parse(challenge.control.dispatchedAt)
    || Date.parse(authorization.issuedAt) > Date.now() || Date.now() >= Date.parse(authorization.expiresAt)
    || Date.parse(authorization.expiresAt) > Date.parse(challenge.control.deadlineAt)) throw new CustodyError("snapshot-stale");
}
