/**
 * INPUT:  local guard errors or the Native template adapter's declared refusal
 * OUTPUT: finite operator-safe template error codes
 * POS:    lifecycle boundary — private response bodies, credentials and free-form provider errors never escape
 */
import { MemoryTemplateErrorCodeSchema, type MemoryTemplateErrorCode } from "@taki/shared";
import { HindsightTemplateRefusal } from "../hindsight-template-client.ts";

export function templateErrorCode(error: unknown, fallback: MemoryTemplateErrorCode = "MEMORY_TEMPLATE_NATIVE_REFUSED"): MemoryTemplateErrorCode {
  const message = error instanceof Error ? error.message : null;
  const own = MemoryTemplateErrorCodeSchema.safeParse(message);
  if (own.success && !(error instanceof HindsightTemplateRefusal)) return own.data;
  if (message === "HINDSIGHT_EXTENSION_UNSUPPORTED") return "MEMORY_TEMPLATE_UNSUPPORTED";
  if (message === "HINDSIGHT_TEMPLATE_CONFLICT" || message === "HINDSIGHT_STATE_CONFLICT") return "MEMORY_TEMPLATE_CONFLICT";
  if (message === "HINDSIGHT_RESPONSE_INVALID") return "MEMORY_TEMPLATE_EVIDENCE_INVALID";
  if (error instanceof HindsightTemplateRefusal) {
    if (["request_too_large", "response_too_large"].includes(error.reason)) return "MEMORY_TEMPLATE_TOO_LARGE";
    if (["snapshot_conflict", "resource_conflict", "request_conflict"].includes(error.reason)) return "MEMORY_TEMPLATE_CONFLICT";
    if (["generation_mismatch", "bank_not_found"].includes(error.reason)) return "MEMORY_TEMPLATE_IDENTITY_CHANGED";
    if (error.reason === "unsupported_storage") return "MEMORY_TEMPLATE_UNSUPPORTED";
  }
  return fallback;
}
