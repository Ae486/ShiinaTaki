/**
 * INPUT:  C2 ownership, registration, adapter and custody refusals
 * OUTPUT: closed value-free errors suitable for bounded deployment status
 * POS:    hindsight-host — exceptions never expose rejected input or process diagnostics
 */
import type { DeploymentRefusal } from "@taki/shared/hindsight-deployment";
import { CustodyError } from "./custody-error.ts";

export class DeploymentError extends Error {
  readonly reason: DeploymentRefusal;
  constructor(reason: DeploymentRefusal) {
    super("hindsight deployment unavailable");
    this.reason = reason;
  }
}
export function deploymentReason(error: unknown): DeploymentRefusal {
  return error instanceof DeploymentError || error instanceof CustodyError ? error.reason : "outcome-unknown";
}
