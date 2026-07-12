/**
 * INPUT:  AI SDK v7 response messages (assistant/tool) and persisted TimelineEntry rows
 * OUTPUT: toEntryInput(message) -> {role, content, parts?} | null  +  toModelMessage(entry) -> ModelMessage | null
 * POS:    core/agents — the persistence mapping for turn fidelity (D1 #1); conversation-store is its only consumer
 */
import type { AssistantModelMessage, ModelMessage, ToolModelMessage, ToolResultPart } from "ai";
import type { TimelineEntry, TimelinePart, TimelineRole, TimelineToolOutput } from "@taki/shared";

/** What `result.responseMessages` yields (the SDK's ResponseMessage union, which it does not export). */
export type TurnMessage = AssistantModelMessage | ToolModelMessage;

export interface TurnEntryInput {
  role: TimelineRole;
  content: string;
  parts?: TimelinePart[];
}

/** Null = nothing persistable (e.g. an empty or reasoning-only message). */
export function toEntryInput(message: TurnMessage): TurnEntryInput | null {
  return message.role === "tool" ? toolEntry(message) : assistantEntry(message);
}

function assistantEntry(message: AssistantModelMessage): TurnEntryInput | null {
  if (typeof message.content === "string") {
    return message.content.length > 0 ? { role: "assistant", content: message.content } : null;
  }
  const parts: TimelinePart[] = [];
  for (const part of message.content) {
    if (part.type === "text") parts.push({ type: "text", text: part.text });
    // Reasoning/file/approval parts are dropped by design — no replay value (docs/deferred-decisions.md D14).
    else if (part.type === "tool-call") {
      parts.push({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
    }
  }
  if (parts.every((part) => part.type === "text")) {
    // Pure text collapses to a legacy-shaped row: content only, no parts (keeps old and new rows uniform).
    const text = parts.map((part) => part.text).join("");
    return text.length > 0 ? { role: "assistant", content: text } : null;
  }
  return { role: "assistant", content: summarize(parts), parts };
}

function toolEntry(message: ToolModelMessage): TurnEntryInput | null {
  const parts: TimelinePart[] = [];
  for (const part of message.content) {
    if (part.type !== "tool-result") continue; // approval responses carry no transcript value
    // The SDK's tagged ToolResultOutput is persisted as-is; the zod schema re-validates it on read.
    parts.push({
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: part.output as TimelineToolOutput,
    });
  }
  return parts.length > 0 ? { role: "tool", content: summarize(parts), parts } : null;
}

// The text projection: readable for UI fast-render + episodic recall; tool payloads stay in parts (names only here).
function summarize(parts: TimelinePart[]): string {
  return parts
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "tool-call") return `[tool-call: ${part.toolName}]`;
      return `[tool-result: ${part.toolName} -> ${part.output.type}]`;
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Null = unreplayable row (a tool row without parts cannot be reconstructed — defensive, we never write one). */
export function toModelMessage(entry: TimelineEntry): ModelMessage | null {
  if (entry.role === "user") return { role: "user", content: entry.content };
  if (entry.role === "tool") {
    const content = (entry.parts ?? []).filter((part) => part.type === "tool-result").map(toSdkToolResult);
    return content.length > 0 ? { role: "tool", content } : null;
  }
  if (!entry.parts || entry.parts.length === 0) return { role: "assistant", content: entry.content };
  return {
    role: "assistant",
    content: entry.parts
      .filter((part) => part.type !== "tool-result")
      .map((part) =>
        part.type === "text"
          ? { type: "text" as const, text: part.text }
          : { type: "tool-call" as const, toolCallId: part.toolCallId, toolName: part.toolName, input: part.input },
      ),
  };
}

function toSdkToolResult(part: Extract<TimelinePart, { type: "tool-result" }>): ToolResultPart {
  return {
    type: "tool-result",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    // Round-trip of the tagged union the SDK wrote; the zod boundary guaranteed {type, value} shape.
    output: part.output as ToolResultPart["output"],
  };
}
