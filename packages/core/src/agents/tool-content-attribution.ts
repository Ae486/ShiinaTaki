/**
 * INPUT: exact completed SDK tool pairs and captured supplier facts within one Attempt
 * OUTPUT: bounded origin recovery after SDK conversion discards process-local part identity
 * POS: core/agents — metadata only; collisions remain unknown and no tool content is retained
 */
import type { ModelMessage } from "ai";
import type { ContextContentOrigin } from "@taki/shared";
import { contentOrigin } from "./context-attribution.ts";

export function toolInteractionKey(part: { toolCallId: string; toolName: string }): string { return JSON.stringify([part.toolCallId, part.toolName]); }

export function createToolContentAttribution() {
  const origins = new Map<string, ContextContentOrigin>();
  const remember = (key: string, origin: ContextContentOrigin) => {
    if (!origins.has(key)) origins.set(key, origin);
    else if (origins.get(key) !== origin) origins.set(key, "unknown");
  };
  return {
    prime(messages: ModelMessage[]) {
      origins.clear();
      for (const message of messages) if (Array.isArray(message.content)) for (const part of message.content) {
        if (part.type === "tool-call" || part.type === "tool-result") remember(toolInteractionKey(part),
          contentOrigin(part) ?? (part.type === "tool-result" ? contentOrigin(part.output) : undefined) ?? "unknown");
      }
    },
    capture(results: readonly { toolCallId: string; toolName: string; output: unknown }[], suppliers: ReadonlyMap<string, ContextContentOrigin>) {
      for (const result of results) remember(toolInteractionKey(result), contentOrigin(result.output) ?? suppliers.get(result.toolName) ?? "unknown");
    },
    origin(part: { toolCallId: string; toolName: string }): ContextContentOrigin | undefined { return origins.get(toolInteractionKey(part)); },
  };
}
