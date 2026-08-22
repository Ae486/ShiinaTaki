/**
 * INPUT:  transport, HTTP, validation, and setup failure categories
 * OUTPUT: HindsightError carrying only a stable code, retry flag, and bounded next action
 * POS:    core/memory/hindsight — sanitization boundary; raw provider errors never cross it
 */
import type { HindsightErrorCode, HindsightSetupError } from "@taki/shared";

export class HindsightError extends Error {
  readonly code: HindsightErrorCode;
  readonly retryable: boolean;
  readonly nextAction: string;

  constructor(error: HindsightSetupError) {
    super(error.code);
    this.name = "HindsightError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.nextAction = error.nextAction;
  }

  projection(): HindsightSetupError {
    return { code: this.code, retryable: this.retryable, nextAction: this.nextAction };
  }
}

export function hindsightError(code: HindsightErrorCode): HindsightError {
  const retryable = !["HINDSIGHT_ENDPOINT_REJECTED", "HINDSIGHT_AUTHENTICATION_FAILED", "HINDSIGHT_VERSION_UNSUPPORTED",
    "HINDSIGHT_EXTENSION_UNSUPPORTED", "HINDSIGHT_DATABASE_UNSUPPORTED", "HINDSIGHT_TEMPLATE_INVALID",
    "HINDSIGHT_STATE_CONFLICT", "HINDSIGHT_OPERATION_IDENTITY_CONFLICT"].includes(code);
  return new HindsightError({ code, retryable, nextAction: NEXT_ACTION[code] });
}

const NEXT_ACTION: Record<HindsightErrorCode, string> = {
  HINDSIGHT_SECRET_UNAVAILABLE: "Set or unlock the Hindsight connection secret, then retry.",
  HINDSIGHT_ENDPOINT_REJECTED: "Use an explicit permitted HTTP or HTTPS endpoint.",
  HINDSIGHT_UNREACHABLE: "Check the Hindsight service and network, then retry.",
  HINDSIGHT_TIMEOUT: "Check service load or retry explicitly.",
  HINDSIGHT_CANCELLED: "Retry explicitly when ready.",
  HINDSIGHT_AUTHENTICATION_FAILED: "Replace the Hindsight API key, then validate again.",
  HINDSIGHT_HEALTH_FAILED: "Repair the Hindsight database or service, then validate again.",
  HINDSIGHT_VERSION_UNSUPPORTED: "Use the admitted Hindsight 0.9.0 deployment.",
  HINDSIGHT_EXTENSION_UNSUPPORTED: "Use the accepted Taki compatibility build.",
  HINDSIGHT_DATABASE_UNSUPPORTED: "Use a supported PostgreSQL deployment.",
  HINDSIGHT_TEMPLATE_INVALID: "Repair or upgrade the Taki Bank Template before retrying.",
  HINDSIGHT_TEMPLATE_CONFLICT: "Refresh setup state and retry the idempotent stage.",
  HINDSIGHT_SNAPSHOT_EXPIRED: "Capture a fresh cursor-bound logical snapshot.",
  HINDSIGHT_SNAPSHOT_NOT_FOUND: "Capture a fresh cursor-bound logical snapshot.",
  HINDSIGHT_SNAPSHOT_PAGE_MISSING: "Discard the staging replica and capture a fresh snapshot.",
  HINDSIGHT_CURSOR_RESET_REQUIRED: "Discard the staging replica and reconcile from a fresh snapshot.",
  HINDSIGHT_SNAPSHOT_INTEGRITY: "Discard the snapshot and retry after verifying the admitted compatibility build.",
  HINDSIGHT_OPERATION_IDENTITY_CONFLICT: "Stop import and inspect the deterministic operation identity conflict.",
  HINDSIGHT_LLM_HEALTH_UNAVAILABLE: "Repair model configuration and run the explicit check again.",
  HINDSIGHT_STATE_CONFLICT: "Refresh status and retry with its current revision.",
  HINDSIGHT_RESPONSE_INVALID: "Use the exact admitted Hindsight compatibility build.",
};
