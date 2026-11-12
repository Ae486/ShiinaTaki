/**
 * INPUT:  canonical step rows plus ordered text spans and exact per-step invocation snapshots
 * OUTPUT: presentation-only stable references into existing canonical content/parts
 * POS:    core/agents — no copied transcript, raw tool input, current catalog lookup, or replay transformation
 */
import type { ChatActivityTerminal, TimelineItemReference, TimelineTextReference } from "@taki/shared";
import type { ToolInvocationSnapshot } from "./tool-invocation.ts";
import type { TurnEntryInput } from "./turn-mapping.ts";

export interface ActivityStepSource {
  texts: Array<{ sourceId: string; length: number; references: TimelineTextReference[] }>;
  tools: ToolInvocationSnapshot[];
}
interface ToolView {
  order?: number;
  terminal?: ChatActivityTerminal & { durationMs?: number };
}

export function stepActivityReferences(
  row: TurnEntryInput,
  source: ActivityStepSource | undefined,
  tools: ReadonlyMap<string, ToolView>,
): TimelineItemReference[] {
  if (!source) return [];
  const texts = source.texts.filter((text) => text.length > 0);
  if (!row.parts) return plainTextReferences(row.content, texts);
  const references: TimelineItemReference[] = [];
  let textIndex = 0;
  for (const [partIndex, part] of row.parts.entries()) {
    if (part.type === "text") {
      const text = texts[textIndex++];
      if (text?.length === part.text.length) references.push(...text.references.map((ref) => ({ ...ref, partIndex })));
    } else if (part.type === "tool-call" || part.type === "tool-result") {
      const candidates = source.tools.filter((tool) => tool.toolCallId === part.toolCallId && tool.toolName === part.toolName);
      const invocation = candidates.length === 1 ? candidates[0] : undefined;
      const view = invocation && tools.get(invocation.invocationId);
      if (invocation && view?.order !== undefined) references.push({
        kind: "tool", itemId: invocation.invocationId, order: view.order, partIndex, ...view.terminal,
      });
    }
  }
  return references;
}

function plainTextReferences(content: string, texts: ActivityStepSource["texts"]): TimelineTextReference[] {
  if (texts.reduce((sum, text) => sum + text.length, 0) !== content.length) return [];
  let offset = 0;
  return texts.flatMap((text) => {
    const refs = text.references.map((ref) => ({ ...ref, start: ref.start + offset, end: ref.end + offset }));
    offset += text.length;
    return refs;
  });
}
