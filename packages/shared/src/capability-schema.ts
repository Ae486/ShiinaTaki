/**
 * INPUT:  Host-bound capability request/cancel/respond frames and RPC acknowledgement candidates
 * OUTPUT: CAPABILITY_METHODS plus re-exported canonical Host-control capability schemas and types
 * POS:    shared/protocol — compatibility entry for the core↔Node capability channel; canonical shapes live in host-control-schema
 */
import { HOST_CONTROL_METHODS } from "./host-control-schema.ts";

export const CAPABILITY_METHODS = {
  request: HOST_CONTROL_METHODS.request,
  cancel: HOST_CONTROL_METHODS.cancel,
  respond: HOST_CONTROL_METHODS.respond,
} as const;

export {
  CapabilityCancelReasonSchema,
  CapabilityCancelSchema,
  CapabilityAuthorizationLineageSchema,
  CapabilityErrorCodeSchema,
  CapabilityErrorSchema,
  CapabilityRequestSchema,
  CapabilityRespondParamsSchema,
  CapabilitySettlementStateSchema,
  HostFrameAckSchema as CapabilityRespondResultSchema,
} from "./host-control-schema.ts";
export type {
  CapabilityCancel,
  CapabilityAuthorizationLineage,
  CapabilityCancelReason,
  CapabilityError,
  CapabilityErrorCode,
  CapabilityRequest,
  CapabilityRespondParams,
  CapabilitySettlementState,
  HostFrameAck as CapabilityRespondResult,
} from "./host-control-schema.ts";
export {
  CapabilityAuthorizationSchema,
  CapabilityChallengeSchema,
  CapabilityResumeSchema,
} from "./host-approval-schema.ts";
export type {
  CapabilityAuthorization,
  CapabilityChallenge,
  CapabilityResume,
} from "./host-approval-schema.ts";
