/**
 * INPUT:  code-owned callbacks attached to one pending broker request
 * OUTPUT: actual issued request/control mapping and successful final accepted result notifications
 * POS:    core/capabilities — internal producer seam; callbacks and evidence never deserialize from WS
 */
import type { CapabilityAuthorizationLineage, HostOperationControl } from "@taki/shared";
import type { InjectionCheckpointV1, NativeStartupPermitV1 } from "@taki/shared/hindsight-deployment";

export interface CapabilityIssuedRequest {
  requestId: string;
  control: HostOperationControl;
}
export interface CapabilityAcceptedResult extends CapabilityIssuedRequest {
  provenance: { hostId: string; connectionGeneration: number };
  authorization: CapabilityAuthorizationLineage | undefined;
  outcome: { ok: true; output: unknown };
}
export interface CapabilityRequestObservers {
  /** Synchronous owner recording must finish before notify can reach a real Host. */
  onIssued?(issued: CapabilityIssuedRequest): void;
  onAccepted?(accepted: CapabilityAcceptedResult): void;
  /** Only one live C2 inject pending may consume this code-owned checkpoint. */
  beforeHindsightInjection?(checkpoint: InjectionCheckpointV1): NativeStartupPermitV1;
}
