/**
 * INPUT: retained trusted accepted-work source and current captured authority
 * OUTPUT: fail-closed work transition/admission checks; no permission from a provenance label
 * POS: core/harness — existing Run context lifetime; source reconstruction requires explicit continuation
 */
import { ACCEPTED_WORK_PROVIDER, type PreparedPublicationCandidate, type PreparedPublicationRequest,
  type PreparedPublicationAuthorizationScope, type RunWorkRefusal, type TriggerRequest } from "@taki/shared";
import type { RunExecutionContext } from "./run-service.ts";
import { readPreparedPublicationAuthorization,
  type PreparedPublicationAuthorization } from "./prepared-publication-authorization.ts";

export interface AcceptedWorkBinding {
  readonly sourceRef: string;
  /** Every authority callback must be a synchronous, side-effect-free read returning exactly true. */
  isCurrent(): boolean;
  readonly publication?: {
    readonly authorization: PreparedPublicationAuthorization;
    readonly acceptanceRef: string;
    readonly characterId: string;
    readonly validity: PreparedPublicationAuthorizationScope["validity"];
    resolve(input: PreparedPublicationRequest): PreparedPublicationCandidate | undefined;
    isCurrent(candidate: PreparedPublicationCandidate): boolean;
    gate(candidate: PreparedPublicationCandidate): "ready" | "hold" | "suppress";
  };
}

export function workBindingRefusal(context: RunExecutionContext | undefined, sourceRef?: string): RunWorkRefusal | undefined {
  if (!context?.acceptedWork) return "binding_lost";
  if (sourceRef !== undefined && context.acceptedWork.sourceRef !== sourceRef) return "wrong_scope";
  try {
    if (context.acceptedWork.isCurrent() !== true) return "binding_lost";
    if (context.authorityCurrent?.() !== true) return "authority_changed";
    if (context.acceptedWork.publication && !preparedPublicationAuthority(context.acceptedWork)) return "authority_changed";
  } catch { return "authority_changed"; }
  return undefined;
}

export function validateWorkAdmission(request: TriggerRequest, context: RunExecutionContext | undefined): void {
  if (request.provenance.provider !== ACCEPTED_WORK_PROVIDER) return;
  if (request.deliveryClass !== "internal" || request.contextMode !== "autonomous" || !request.provenance.sourceRef
    || workBindingRefusal(context, request.provenance.sourceRef)) throw new Error("RUN_WORK_BINDING_REQUIRED");
  const publication = context?.acceptedWork?.publication;
  if (publication && (publication.characterId !== request.characterId
    || (publication.validity.kind === "expires_at" && (!request.deadlineAt
      || Date.parse(request.deadlineAt) > Date.parse(publication.validity.expiresAt))))) {
    throw new Error("RUN_WORK_BINDING_REQUIRED");
  }
}

export function preparedPublicationAuthority(binding: AcceptedWorkBinding): Readonly<PreparedPublicationAuthorizationScope> | undefined {
  const publication = binding.publication;
  if (!publication) return undefined;
  return readPreparedPublicationAuthorization(publication.authorization, { sourceRef: binding.sourceRef,
    acceptanceRef: publication.acceptanceRef, characterId: publication.characterId, validity: publication.validity });
}
