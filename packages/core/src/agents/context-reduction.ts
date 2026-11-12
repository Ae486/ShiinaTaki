/**
 * INPUT:  an immutable projected request made of typed text candidates or ModelMessages
 * OUTPUT: deterministic projection-only reductions with bounded savings and privacy-safe rendering helpers
 * POS:    core/agents — Slice 4 Context Reduction stage; never mutates Timeline, Memory, or completed Tool Effects
 */
import type { ModelMessage, ToolResultPart } from "ai";
import { estimateMessagesTokens, estimateTokens } from "../memory/token-estimator.ts";
import type { TimelineEntry } from "@taki/shared";
import { renderSourceContext, reduceSourcedToolResult } from "./source-context.ts";
import { attributedContextText, contextText, copyContentOrigin, retainContextText } from "./context-attribution.ts";

export type ReductionClass = "dialogue" | "summary" | "tool-result" | "snapshot" | "reasoning" | "media" | "observation";

export interface ReductionCandidate {
  id: string;
  class: ReductionClass;
  text: string;
  /** Protected candidates are returned byte-identical regardless of pressure. */
  protected?: boolean;
  /** Recent continuity is protected by policy even when the caller does not mark it explicitly. */
  recent?: boolean;
  reducible?: boolean;
}

export interface ReducedCandidate extends ReductionCandidate {
  text: string;
  reduced: boolean;
  savedTokens: number;
}

export interface ContextReductionResult {
  candidates: ReducedCandidate[];
  beforeTokens: number;
  afterTokens: number;
  tokensSaved: number;
  changed: boolean;
}

const REDUCTION_ORDER: ReductionClass[] = ["tool-result", "snapshot", "observation", "reasoning", "media", "summary", "dialogue"];

/** Apply stable bounded reductions. Candidate ordering is preserved; only candidate text is replaced. */
export function reduceContext(input: {
  candidates: ReductionCandidate[];
  targetTokens?: number;
  maxCharsPerCandidate?: number;
}): ContextReductionResult {
  const maxChars = boundedMax(input.maxCharsPerCandidate ?? 1_200);
  const original = input.candidates.map((candidate) => ({ ...candidate }));
  const beforeTokens = original.reduce((sum, candidate) => sum + estimateTokens(candidate.text), 0);
  const reduced = original.map((candidate) => ({ ...candidate, reduced: false, savedTokens: 0 }));
  const ranked = reduced
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => !candidate.protected && !candidate.recent && candidate.reducible !== false
      && (candidate.class !== "dialogue" || candidate.reducible === true))
    .sort((left, right) => rank(left.candidate) - rank(right.candidate) || left.index - right.index);
  let afterTokens = beforeTokens;
  for (const { candidate } of ranked) {
    if (input.targetTokens !== undefined && afterTokens <= input.targetTokens) break;
    const next = reducedText(candidate, maxChars);
    if (next === candidate.text) continue;
    const saved = Math.max(0, estimateTokens(candidate.text) - estimateTokens(next));
    candidate.text = next;
    candidate.reduced = true;
    candidate.savedTokens = saved;
    afterTokens -= saved;
  }
  return { candidates: reduced, beforeTokens, afterTokens, tokensSaved: beforeTokens - afterTokens, changed: afterTokens < beforeTokens };
}

/** Reduce a ModelMessage projection without changing the caller's array or protected recent tail. */
export function reduceMessages(input: {
  messages: ModelMessage[];
  targetTokens?: number;
  recentMessages?: number;
  /** Replay View marks whether the first message is the typed rolling-summary projection. */
  summaryHead?: boolean;
}): { messages: ModelMessage[]; tokensSaved: number; beforeTokens: number; afterTokens: number } {
  const recent = Math.max(0, Math.floor(input.recentMessages ?? 4));
  const candidates = input.messages.map((message, index) => {
    const summary = isSummaryHead(message, index, input.summaryHead);
    return {
      id: String(index),
      class: summary ? "summary" as const : message.role === "tool" ? "tool-result" as const : "dialogue" as const,
      text: messageText(message),
      recent: summary ? false : message.role === "tool" ? false : index >= input.messages.length - recent,
      // Every non-summary dialogue message is protected. A final tool row is not the current user message and remains
      // reducible in a post-turn Replay that ended immediately after a tool result.
      protected: !summary && message.role !== "tool",
      reducible: summary || message.role === "tool",
    };
  });
  const beforeTokens = estimateMessagesTokens(input.messages);
  const messages = [...input.messages];
  let afterTokens = beforeTokens;
  const ranked = candidates.map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.reducible && !candidate.protected && !candidate.recent)
    .sort((left, right) => rank(left.candidate) - rank(right.candidate) || left.index - right.index);
  // Candidate text is bounded for safe rendering, so it cannot price the original provider payload. Check actual
  // message costs after each replacement; a large tool result may make the summary safe to preserve verbatim.
  for (const { candidate, index } of ranked) {
    if (input.targetTokens !== undefined && afterTokens <= input.targetTokens) break;
    const original = messages[index];
    if (original === undefined) continue;
    const replacement = replaceMessage(original, { ...candidate, text: reducedText(candidate, 1_200),
      reduced: true, savedTokens: 0 });
    const saved = estimateMessagesTokens([original]) - estimateMessagesTokens([replacement]);
    if (saved <= 0) continue;
    messages[index] = replacement;
    afterTokens -= saved;
  }
  return { messages, tokensSaved: beforeTokens - afterTokens, beforeTokens, afterTokens };
}

/** Bounded, prompt-safe projection for tool/MCP/file observations. */
export function projectExternalFact(input: { source: string; text: string; maxChars?: number }): string {
  const source = headTail(input.source.trim(), 80) || "external";
  const text = headTail(scrubSensitive(input.text), boundedMax(input.maxChars ?? 2_000));
  return `<fact source="${escapeXml(source)}">${escapeXml(text)}</fact>`;
}

/** Render compaction input without raw tool payloads, credentials, or unbounded content. */
export function renderSafeTranscript(entries: TimelineEntry[]): string {
  return entries.map((entry) => {
    const bounded = headTail(scrubSensitive(entry.content), entry.role === "tool" ? 2_000 : 8_000);
    const source = scrubSensitive(renderSourceContext(entry.sourceContext));
    if (entry.role !== "tool") return [source, `${entry.role}: ${bounded}`].filter(Boolean).join("\n");
    const facts = (entry.parts ?? []).filter((part) => part.type === "tool-result").map((part) => {
      // Tool outputs may use AI SDK's `content` variant, whose nested file parts carry raw bytes. Project those
      // parts to a marker before serialization so the compaction prompt cannot receive media payloads.
      const output = part.output.value === undefined ? "" : stringifyValue(sanitizeToolValue(part.output.value));
      const material = scrubSensitive(renderSourceContext({ materials: part.sourceMaterials?.flatMap((item) => item.source ? [item.source] : []) }));
      const body = projectExternalFact({ source: `${part.toolName}:${part.toolCallId}`, text:
        `${part.toolName}(${part.toolCallId}): Outcome: ${part.output.type}. ${output || (typeof part.output.reason === "string" ? part.output.reason : "[no value]")}`, maxChars: 1_500 });
      return [material, body].filter(Boolean).join("\n");
    }).join("\n");
    return [source, `${entry.role}: ${facts || projectExternalFact({ source: "tool-result", text: bounded, maxChars: 1_500 })}`]
      .filter(Boolean).join("\n");
  }).join("\n");
}

/** Shared bounded redaction for the previous rolling summary projection. */
export function sanitizeCompactionText(value: string, maxChars = 8_000): string {
  return headTail(scrubSensitive(value), boundedMax(maxChars));
}

function rank(candidate: ReductionCandidate): number {
  const index = REDUCTION_ORDER.indexOf(candidate.class);
  return index < 0 ? REDUCTION_ORDER.length : index;
}

function reducedText(candidate: ReductionCandidate, maxChars: number): string {
  if (candidate.class === "tool-result" || candidate.class === "snapshot" || candidate.class === "observation") {
    return headTail(candidate.text, maxChars);
  }
  if (candidate.class === "reasoning" || candidate.class === "media") return `[${candidate.class} omitted]`;
  if (candidate.class === "summary") return headTail(candidate.text, maxChars);
  return headTail(candidate.text, maxChars);
}

function headTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const marker = "\n[... reduced ...]\n";
  if (maxChars <= marker.length) return value.slice(0, maxChars);
  const available = maxChars - marker.length;
  const head = Math.ceil(available * 0.65);
  const tail = Math.max(0, available - head);
  return `${value.slice(0, head)}${marker}${tail > 0 ? value.slice(-tail) : ""}`;
}

function messageText(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => {
    if ("text" in part) return part.text;
    if (part.type === "tool-result" && "output" in part) {
      return typeof part.output === "object" && part.output !== null && "value" in part.output
        ? stringifyValue(sanitizeToolValue(part.output.value ?? "", 0, false))
        : stringifyValue(part.output);
    }
    return "type" in part ? `[${part.type}]` : "";
  }).join(" ");
}

function replaceMessage(message: ModelMessage, candidate: ReducedCandidate): ModelMessage {
  if (!candidate.reduced) return message;
  if (candidate.class === "summary" && message.role === "user" && typeof message.content === "string") {
    const content = reduceSummaryContent(message.content, candidate.text);
    const replacement = { ...message, content };
    return attributedContextText(message) ? retainContextText(replacement, contextText(content, "summary")) : replacement;
  }
  if (message.role !== "tool" || !Array.isArray(message.content)) return message;
  const content = message.content.map((part) => {
    if (part.type !== "tool-result") return part;
    return copyContentOrigin(part, { ...part, output: reduceSourcedToolResult(part.output, (output) => reduceToolOutput(output) as ToolResultPart["output"]) });
  });
  return { ...message, content } as ModelMessage;
}

function reduceToolOutput(output: unknown): unknown {
  if (typeof output !== "object" || output === null) return output;
  const value = output as { type?: unknown; value?: unknown; reason?: unknown };
  if ((value.type === "text" || value.type === "error-text") && typeof value.value === "string") {
    return { ...value, value: headTail(scrubSensitive(value.value), 1_500) };
  }
  if (value.type === "json" || value.type === "error-json") {
    return { type: value.type === "error-json" ? "error-text" : "text",
      value: headTail(scrubSensitive(stringifyValue(sanitizeToolValue(value.value))), 1_500) };
  }
  if (value.type === "content") {
    return { type: "text", value: headTail(scrubSensitive(stringifyValue(sanitizeToolValue(value.value))), 1_500) };
  }
  if (value.type === "execution-denied" && typeof value.reason === "string") {
    return { ...value, reason: headTail(scrubSensitive(value.reason), 1_500) };
  }
  return output;
}

function scrubSensitive(value: string): string {
  return value.replace(/\bBearer\s+[^\s,;"}]+/gi, "[redacted]")
    .replace(/["']?(?:api[_ -]?key|authorization|access[_ -]?token|password|secret|token)["']?\s*[:=]\s*["']?[^\s,;"}]+/gi, "[redacted]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted]");
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function boundedMax(value: number): number {
  return Number.isSafeInteger(value) && value >= 64 ? Math.min(value, 8_000) : 1_200;
}

function isSummaryHead(message: ModelMessage, index: number, marked: boolean | undefined): boolean {
  return marked === true && index === 0 && message.role === "user" && typeof message.content === "string"
    && message.content.startsWith("<conversation-summary>\n") && message.content.endsWith("\n</conversation-summary>");
}

function reduceSummaryContent(content: string, summary: string): string {
  const prefix = "<conversation-summary>\n";
  const suffix = "\n</conversation-summary>";
  const innerBudget = Math.max(64, summary.length - prefix.length - suffix.length);
  return `${prefix}${headTail(content.slice(prefix.length, -suffix.length), innerBudget)}${suffix}`;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "[unserializable]";
  }
}

function sanitizeToolValue(value: unknown, depth = 0, omitMedia = true): unknown {
  if (typeof value === "string") return headTail(value, 4_000);
  if (Array.isArray(value)) {
    const selected = value.length <= 24
      ? value
      : [...value.slice(0, 16), `[${value.length - 24} items omitted]`, ...value.slice(-8)];
    return selected.map((nested) => sanitizeToolValue(nested, depth + 1, omitMedia));
  }
  if (typeof value !== "object" || value === null) return value;
  if (depth >= 5) return "[nested content omitted]";
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  if (omitMedia && type !== undefined && MEDIA_CONTENT_TYPES.has(type)) {
    return { type, mediaType: typeof record.mediaType === "string" ? record.mediaType : undefined,
      content: "[media omitted]" };
  }
  const entries = Object.entries(record);
  const selected = entries.length <= 24
    ? entries
    : [...entries.slice(0, 16), ["__omitted__", `${entries.length - 24} fields omitted`] as [string, unknown],
      ...entries.slice(-8)];
  return Object.fromEntries(selected.map(([key, nested]) => [key, sanitizeToolValue(nested, depth + 1, omitMedia)]));
}

const MEDIA_CONTENT_TYPES = new Set([
  "file", "file-data", "file-url", "file-id", "file-reference",
  "image-data", "image-url", "image-file-id", "image-file-reference", "custom",
]);
