/**
 * INPUT: trusted main-consumer binding and native SDK message/invocation facts
 * OUTPUT: private action recording with independent public text/tool and activity projections
 * POS: core/agents — shared ChatAgent seam; inbox admission and action authority remain with Runtime
 */
import type { ToolSet } from "ai";
import type { EffectLifecycle, SourceContext, TimelineEntry } from "@taki/shared";
import type { ToolActivityObserver } from "./tool-observability.ts";
import type { ToolInvocationSnapshot } from "./tool-invocation.ts";
import type { TurnMessage } from "./turn-mapping.ts";

export interface ForegroundInboxContext {
  readonly tools: ToolSet;
  readonly instructions: string;
  readonly sourceContext?: SourceContext;
  /** Claim only the first nonempty batch at a safe request boundary; registered tools stay immutable. */
  prepareStep?(): void;
  commitModelIntent(effect: EffectLifecycle, stepNumber: number): void;
  recordCompletedStep(input: { attemptId: string; stepNumber: number; messages: TurnMessage[] }): void;
  hasIntent(): boolean;
  dispose(): void;
  onPublicCommitted?(entries: readonly TimelineEntry[]): void;
}

export interface ForegroundInboxInput {
  characterId: string;
  runId: string;
  attemptId: string;
  actualInvocation(): ToolInvocationSnapshot | undefined;
}

/** Membership comes from the registered, executable consumer tools, never model arguments or prose. */
export function createForegroundInboxProjection(tools: ToolSet) {
  const names = new Set(Object.keys(tools));
  const isPrivate = (part: { toolName?: string }) => part.toolName !== undefined && names.has(part.toolName);
  return {
    isPrivate,
    split(messages: TurnMessage[]) {
      const publicMessages: TurnMessage[] = [];
      const privateMessages: TurnMessage[] = [];
      for (const message of messages) {
        if (typeof message.content === "string") {
          publicMessages.push(message);
        } else if (message.role === "assistant") {
          const internal = message.content.filter((part) => part.type === "tool-call" && isPrivate(part));
          const visible = message.content.filter((part) => part.type !== "tool-call" || !isPrivate(part));
          if (internal.length) privateMessages.push({ ...message, content: internal });
          if (visible.length) publicMessages.push({ ...message, content: visible });
        } else {
          const internal = message.content.filter((part) => part.type === "tool-result" && isPrivate(part));
          const visible = message.content.filter((part) => part.type !== "tool-result" || !isPrivate(part));
          if (internal.length) privateMessages.push({ ...message, content: internal });
          if (visible.length) publicMessages.push({ ...message, content: visible });
        }
      }
      return { publicMessages, privateMessages };
    },
    activity(observer: ToolActivityObserver | undefined): ToolActivityObserver | undefined {
      if (!observer) return undefined;
      return {
        phase: (invocation, phase) => { if (!isPrivate(invocation)) observer.phase(invocation, phase); },
        terminal: (invocation, outcome, durationMs) => {
          if (!isPrivate(invocation)) observer.terminal(invocation, outcome, durationMs);
        },
      };
    },
  };
}
