/**
 * INPUT: actual native dispatch content and construction-owned descriptors
 * OUTPUT: exclusive heuristic composition with honest source/framing/media coverage
 * POS: core/agents — counts only; uses the same estimator as request pressure
 */
import type { ModelMessage } from "ai";
import { CONTEXT_CATEGORIES, CONTEXT_CONTENT_ORIGINS, type ContextCategory, type ContextContentOrigin,
  type RequestComposition } from "@taki/shared";
import { estimateMessageTokens, estimateTokens, MESSAGE_OVERHEAD } from "../memory/token-estimator.ts";
import { attributedContextText, contentOrigin, type AttributedText } from "./context-attribution.ts";
import { nativeImageSource } from "./native-image-projection.ts";
import type { NativeDispatchInput } from "./native-image-attempt.ts";
import { toolInteractionKey } from "./tool-content-attribution.ts";

export interface RequestDescriptors {
  instructions?: AttributedText;
  texts: ReadonlyMap<string, AttributedText | null | undefined>;
  toolOrigins: ReadonlyMap<string, ContextContentOrigin>;
  interactions: ReadonlyMap<string, readonly ContextContentOrigin[]>;
}

/** Ambiguous identical strings remain unclassified; never borrow another occurrence's source. */
export function describeMessages(messages: ModelMessage[], resolve?: (part: { toolCallId: string; toolName: string }) => ContextContentOrigin | undefined): Pick<RequestDescriptors, "texts" | "interactions"> {
  const texts = new Map<string, AttributedText | null | undefined>();
  const interactions = new Map<string, ContextContentOrigin[]>();
  const remember = (value: string, descriptor: AttributedText | undefined) => {
    if (!texts.has(value)) texts.set(value, descriptor);
    else if (texts.get(value) === null || JSON.stringify(texts.get(value)?.spans) !== JSON.stringify(descriptor?.spans)) texts.set(value, null);
  };
  for (const message of messages) {
    const text = attributedContextText(message);
    if (typeof message.content === "string") remember(message.content, text);
    if (Array.isArray(message.content)) for (const part of message.content) {
      if (part.type === "tool-call" || part.type === "tool-result") {
        const key = toolInteractionKey(part);
        const values = interactions.get(key) ?? [];
        values.push(contentOrigin(part) ?? (part.type === "tool-result" ? contentOrigin(part.output) : undefined) ?? resolve?.(part) ?? "unknown");
        interactions.set(key, values);
      }
      const descriptor = attributedContextText(part);
      if (part.type === "text") remember(part.text, descriptor ?? (text?.text === part.text ? text : undefined));
    }
  }
  return { texts, interactions };
}

export function measureRequestComposition(request: NativeDispatchInput, descriptors: RequestDescriptors): RequestComposition {
  const categories = Object.fromEntries(CONTEXT_CATEGORIES.map((key) => [key, 0])) as RequestComposition["categories"];
  const origins = Object.fromEntries(CONTEXT_CATEGORIES.map((key) => [key,
    Object.fromEntries(CONTEXT_CONTENT_ORIGINS.map((origin) => [origin, 0]))])) as RequestComposition["origins"];
  const add = (units: number, category: ContextCategory, origin: ContextContentOrigin) => {
    categories[category] += units; origins[category][origin] += units;
  };
  allocateText({ text: request.instructions, descriptor: descriptors.instructions, fallback: { category: "instructions", origin: "unknown" }, add });
  const { unestimatedParts, hasHeuristicMedia } = allocateMessages({ messages: request.outgoing, descriptors, add });
  allocateTools({ definitions: request.preparedTools, suppliers: descriptors.toolOrigins, add });
  const unknownOriginUnits = CONTEXT_CATEGORIES.reduce((sum, category) => sum + origins[category].unknown, 0);
  const totalUnits = CONTEXT_CATEGORIES.reduce((sum, category) => sum + categories[category], 0);
  return { estimator: "heuristic-v1", totalUnits, categories, origins, coverage: {
    status: unestimatedParts || unknownOriginUnits ? "partial" : "complete",
    unestimatedParts, unknownOriginUnits, hasHeuristicMedia } };
}

type AddUnits = (units: number, category: ContextCategory, origin: ContextContentOrigin) => void;
function allocateText(input: { text: string; descriptor?: AttributedText | null;
  fallback: { category: ContextCategory; origin: ContextContentOrigin }; add: AddUnits }): void {
    const { text, descriptor, fallback, add } = input;
    if (descriptor === null) { add(estimateTokens(text), "other", "unknown"); return; }
    if (!descriptor || descriptor.text !== text) { add(estimateTokens(text), fallback.category, fallback.origin); return; }
    let previous = 0;
    let offset = 0;
    for (const span of descriptor.spans) {
      if (span.start !== offset || span.end < span.start || span.end > text.length) { add(estimateTokens(text), "other", "unknown"); return; }
      offset = span.end;
    }
    if (offset !== text.length) { add(estimateTokens(text), "other", "unknown"); return; }
    // Cumulative rounding preserves the estimate of the original whole string, including mixed CJK fragments.
    for (const span of descriptor.spans) {
      const cumulative = estimateTokens(text.slice(0, span.end));
      add(cumulative - previous, span.category, span.origin); previous = cumulative;
    }
}

function allocateMessages(input: { messages: ModelMessage[]; descriptors: RequestDescriptors; add: AddUnits }) {
  const { messages, descriptors, add } = input;
  let unestimatedParts = 0;
  let hasHeuristicMedia = false;
  const interactionOffsets = new Map<string, number>();
  for (const message of messages) {
    add(MESSAGE_OVERHEAD, "other", "builtin");
    const source = nativeImageSource(message);
    const fallback = source?.kind === "tool" || message.role === "tool" ? "tool_interactions"
      : source?.kind === "context" ? "runtime_context" : "conversation";
    const supplier = source?.kind === "tool" ? source.contextOrigin ?? "unknown" : "builtin";
    if (typeof message.content === "string") allocateText({ text: message.content, descriptor: descriptors.texts.get(message.content), fallback: { category: fallback, origin: supplier }, add });
    else for (const part of message.content) {
      if (part.type === "text") allocateText({ text: part.text, descriptor: descriptors.texts.get(part.text), fallback: { category: fallback, origin: supplier }, add });
      else {
        const units = estimateMessageTokens({ role: "user", content: [part] } as ModelMessage) - MESSAGE_OVERHEAD;
        if (part.type === "file" || part.type === "image") hasHeuristicMedia = true;
        const interaction = part.type === "tool-call" || part.type === "tool-result";
        if (!interaction && part.type !== "file" && part.type !== "image") unestimatedParts += 1;
        let origin = supplier;
        if (interaction) {
          const key = toolInteractionKey(part);
          const offset = interactionOffsets.get(key) ?? 0;
          origin = descriptors.interactions.get(key)?.[offset] ?? "unknown";
          interactionOffsets.set(key, offset + 1);
        }
        add(units, interaction ? "tool_interactions" : fallback, origin);
      }
    }
  }
  return { unestimatedParts, hasHeuristicMedia };
}

function allocateTools(input: { definitions: NativeDispatchInput["preparedTools"];
  suppliers: RequestDescriptors["toolOrigins"]; add: AddUnits }): void {
  const { definitions, suppliers, add } = input;
  // Same JSON-array estimator as the existing schema producer. Array punctuation is framing.
  let prior = estimateTokens("[");
  add(prior, "other", "builtin");
  let schemaText = "[";
  for (const [index, tool] of definitions.entries()) {
    schemaText += `${index ? "," : ""}${JSON.stringify(tool)}`;
    const cumulative = estimateTokens(schemaText);
    add(cumulative - prior, "tool_definitions", typeof tool.name === "string" ? suppliers.get(tool.name) ?? "unknown" : "unknown");
    prior = cumulative;
  }
  add(estimateTokens(`${schemaText}]`) - prior, "other", "builtin");
}
