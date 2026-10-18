/**
 * INPUT:  fixed C1 refusal categories from installation, protocol and credential adapters
 * OUTPUT: value-free errors and public unavailable status
 * POS:    hindsight-host — the only public failure projection; never exposes exception causes
 */
import type { HindsightCustodyRefusal, HindsightCustodyResult } from "@taki/shared/hindsight-custody";

export class CustodyError extends Error {
  readonly reason: HindsightCustodyRefusal;
  constructor(reason: HindsightCustodyRefusal) {
    super("hindsight custody unavailable");
    this.name = "CustodyError";
    this.reason = reason;
  }
}
export function custodyFailure(error: unknown): HindsightCustodyResult {
  return {
    version: 1, state: "unavailable", deploymentReady: false,
    reason: error instanceof CustodyError ? error.reason : "custody-locked",
  };
}
