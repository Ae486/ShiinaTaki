/**
 * INPUT:  AI SDK v7 response messages (assistant/tool) and persisted TimelineEntry rows
 * OUTPUT: names-only tool-call persistence plus safe replay messages; raw tool input is never returned or stored
 * POS:    core/agents — the privacy boundary between live AI SDK turns and durable/replayed timeline records
 */
import type { AssistantModelMessage, ModelMessage, ToolModelMessage, ToolResultPart } from "ai";
import type { TimelineEntry, TimelinePart, TimelineRole, TimelineToolOutput } from "@taki/shared";

/** What `result.responseMessages` yields (the SDK's ResponseMessage union, which it does not export). */
export type TurnMessage = AssistantModelMessage | ToolModelMessage;

/** The image inputs appendUser persists as image parts (mediaType + workspace-relative ref; bytes live in the media store). */
export type UserImageInput = Omit<Extract<TimelinePart, { type: "image" }>, "type">;

export interface TurnEntryInput {
  role: TimelineRole;
  content: string;
  parts?: TimelinePart[];
}

/** Null = nothing persistable (e.g. an empty or reasoning-only message). */
export function toEntryInput(message: TurnMessage): TurnEntryInput | null {
  return message.role === "tool" ? toolEntry(message) : assistantEntry(message);
}

// A user turn's persisted shape (#17): no images = legacy `{role:"user", content}` row (byte-identical to today); with
// images the row carries a text part (only when the caption is non-empty) + one image part per attachment, and the
// content projection is the caption or "[image]". Replay (toModelMessage) drops the image parts — bytes never re-enter
// the model (decision 6); the vision model saw them in-flight, later recall rides the description-memory.
export function toUserEntryInput(text: string, images: UserImageInput[]): TurnEntryInput {
  if (images.length === 0) return { role: "user", content: text };
  const parts: TimelinePart[] = [];
  if (text.length > 0) parts.push({ type: "text", text });
  for (const image of images) parts.push({ type: "image", mediaType: image.mediaType, ref: image.ref });
  return { role: "user", content: text.length > 0 ? text : "[image]", parts };
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
      parts.push({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName });
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
      // Image parts never reach summarize (user rows project their content directly), but keep the map exhaustive.
      if (part.type === "image") return "[image]";
      return `[tool-result: ${part.toolName} -> ${part.output.type}]`;
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Null = unreplayable row (a tool row without parts cannot be reconstructed — defensive, we never write one). */
export function toModelMessage(entry: Pick<TimelineEntry, "role" | "content" | "parts">): ModelMessage | null {
  if (entry.role === "user") return { role: "user", content: entry.content };
  if (entry.role === "tool") {
    const content = (entry.parts ?? []).filter((part) => part.type === "tool-result").map(toSdkToolResult);
    return content.length > 0 ? { role: "tool", content } : null;
  }
  if (!entry.parts || entry.parts.length === 0) return { role: "assistant", content: entry.content };
  return {
    role: "assistant",
    content: entry.parts
      // text|tool-call only: assistant rows never carry image parts (those live on user rows) — the explicit predicate
      // keeps the inferred type guard tight now that TimelinePart includes the image variant.
      .filter((part) => part.type === "text" || part.type === "tool-call")
      .map((part) =>
        part.type === "text"
          ? { type: "text" as const, text: part.text }
          : { type: "tool-call" as const, toolCallId: part.toolCallId, toolName: part.toolName, input: {} },
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
