/**
 * INPUT:  canonical SDK tool-output envelopes retained on historical Timeline parts
 * OUTPUT: conservative historical outcomes and useful literal result details without transport wrappers
 * POS:    ui/chat — legacy display fallback; new invocations prefer Core's pre-conversion captured outcome
 */
import type { ChatActivityToolStatus, TimelineToolOutput } from "@taki/shared";
import { patternToolDetails } from "@/features/initiative-patterns/pattern-tool-display.js";
import { followUpToolDetails } from "@/features/initiative-patterns/follow-up-tool-display.js";

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function historicalToolStatus(output?: TimelineToolOutput): ChatActivityToolStatus {
  if (!output) return { phase: "settled", outcome: "outcome_unknown" };
  if (output.type === "execution-denied") return { phase: "settled", outcome: "failed", message: "操作未获授权" };
  if (output.type.startsWith("error")) return { phase: "settled", outcome: "failed" };
  const value = record(output.value);
  if (value?.isError === true) return { phase: "settled", outcome: "failed" };
  if (value?.ok === false) {
    const code = value.code ?? record(value.error)?.code;
    const outcome = value.state === "outcome_unknown" || code === "OUTCOME_UNKNOWN" || code === "MEMORY_OUTCOME_UNKNOWN"
      ? "outcome_unknown" : value.state === "cancelled" || code === "CANCELLED" || code === "MEMORY_OPERATION_CANCELLED"
        ? "cancelled" : "failed";
    return { phase: "settled", outcome };
  }
  // MCP conversion can drop isError while retaining content. The resulting envelope proves a return, not success.
  return { phase: "settled", outcome: output.type === "text" || output.type === "json" ? "completed" : "outcome_unknown" };
}

export function toolOutputDetails(output?: TimelineToolOutput, toolName?: string): string | null {
  if (!output) return toolName === "manage_interaction_pattern" || toolName === "plan_follow_up" ? "" : null;
  const value = output.type === "execution-denied" ? output.reason : output.value;
  if (toolName === "manage_interaction_pattern") return patternToolDetails(unwrapResult(value));
  if (toolName === "plan_follow_up") return followUpToolDetails(unwrapResult(value));
  if (output.type === "content" && Array.isArray(value)) return contentText(value);
  const unwrapped = unwrapResult(value);
  if (typeof unwrapped === "string") return unwrapped.trim().length > 0 ? unwrapped : null;
  if (unwrapped === undefined || unwrapped === null) return null;
  if (Array.isArray(unwrapped) && unwrapped.length === 0) return null;
  const object = record(unwrapped);
  if (object && Object.keys(object).length === 0) return null;
  return JSON.stringify(unwrapped, null, 2);
}

function unwrapResult(value: unknown): unknown {
  const object = record(value);
  if (!object) return value;
  // Remove only recognized envelopes. Business fields such as id/version remain meaningful returned data.
  if (object.jsonrpc === "2.0") return unwrapResult(object.result ?? object.error);
  if (Array.isArray(object.content) && object.content.every((part) => record(part)?.type !== undefined)) {
    return contentText(object.content);
  }
  if (typeof object.ok === "boolean") {
    const business = { ...object };
    delete business.ok;
    if (Object.keys(business).length === 1 && "data" in business) return business.data;
    if (Object.keys(business).length === 1 && "error" in business) return business.error;
    return business;
  }
  return object;
}

function contentText(parts: unknown[]): string | null {
  const text = parts.flatMap((value) => {
    const part = record(value);
    if (part?.type === "text" && typeof part.text === "string") return [part.text];
    const resource = part?.type === "resource" ? record(part.resource) : null;
    if (resource && typeof resource.text === "string") return [resource.text];
    if (part?.type === "resource_link") return [part.title ?? part.name, part.uri].filter((item): item is string => typeof item === "string");
    return []; // Media bytes and SDK/provider metadata are not readable operation details.
  }).join("\n\n");
  return text.trim().length > 0 ? text : null;
}
