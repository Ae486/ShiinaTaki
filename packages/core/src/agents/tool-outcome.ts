/**
 * INPUT:  an SDK tool result before model-output conversion, with optional preliminary/validation markers
 * OUTPUT: one payload-free terminal classification, or no settlement for preliminary output
 * POS:    core/agents — pure outcome seam shared by Run observations and later activity projections
 */
import { CapabilityErrorCodeSchema, ErrorCodeSchema, MemoryErrorCodeSchema, type RunEvent } from "@taki/shared";

export type ToolOutcome = Pick<Extract<RunEvent["payload"], { kind: "tool.result.settled" }>,
  "outcome" | "errorClass" | "errorCode">;

export interface ToolOutcomeInput {
  type: "tool-result" | "tool-error" | "tool-output-denied";
  output?: unknown;
  preliminary?: boolean;
  invalid?: boolean;
}

export function classifyToolOutcome(input: ToolOutcomeInput & { preliminary?: false }): ToolOutcome;
export function classifyToolOutcome(input: ToolOutcomeInput): ToolOutcome | undefined;
export function classifyToolOutcome(input: ToolOutcomeInput): ToolOutcome | undefined {
  if (input.preliminary) return undefined;
  if (input.invalid) return { outcome: "failed", errorClass: "validation", errorCode: "tool_validation_failed" };
  if (input.type === "tool-output-denied") {
    return { outcome: "failed", errorClass: "governance", errorCode: "tool_output_denied" };
  }
  if (input.type === "tool-error") return { outcome: "failed", errorClass: "execution", errorCode: "tool_error" };
  const value = input.output;
  if (typeof value !== "object" || value === null) return { outcome: "completed" };
  // MCP's model-output converter drops isError. Inspect the original return here, never its content conversion.
  if (Object.hasOwn(value, "isError") && (value as { isError?: unknown }).isError === true) {
    return { outcome: "failed", errorClass: "execution", errorCode: "mcp_tool_error" };
  }
  if (!Object.hasOwn(value, "ok") || (value as { ok?: unknown }).ok !== false) return { outcome: "completed" };
  return classifyFailure(value);
}

// Only framework-owned vocabularies may enter durable diagnostics. Character replacement/truncation
// does not redact a provider's arbitrary code: an otherwise valid identifier may itself contain content.
const KNOWN_FAILURE_CODES = new Set<string>([
  ...ErrorCodeSchema.options, ...CapabilityErrorCodeSchema.options, ...MemoryErrorCodeSchema.options,
  "CAPABILITY_TIMEOUT", "NODE_DISCONNECTED", "CANCELLED", "OUTCOME_UNKNOWN", "MCP_STALE_GENERATION", "STALE_EFFECT",
]);

function classifyFailure(failure: { code?: unknown; state?: unknown; error?: unknown }): ToolOutcome {
  const code = knownErrorCode(failure.code) ?? memoryErrorCode(failure.error) ?? "tool_failed";
  const outcome = failure.state === "outcome_unknown" || code === "outcome_unknown" || code === "memory_outcome_unknown"
    ? "outcome_unknown" as const
    : failure.state === "cancelled" || code === "cancelled" || code === "memory_operation_cancelled"
      ? "cancelled" as const : "failed" as const;
  const errorClass = code === "governance_denied" || code === "approval_required" || code === "denied"
    ? "governance" as const : code === "mcp_stale_generation" || code === "stale_effect" ? "stale" as const : "execution" as const;
  return { outcome, errorClass, errorCode: code };
}

function knownErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && KNOWN_FAILURE_CODES.has(value) ? value.toLowerCase() : undefined;
}

function memoryErrorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, "code")) return undefined;
  const parsed = MemoryErrorCodeSchema.safeParse((value as { code: unknown }).code);
  return parsed.success ? parsed.data.toLowerCase() : undefined;
}
