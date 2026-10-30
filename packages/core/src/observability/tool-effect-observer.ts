/**
 * INPUT:  normalized SDK tool-call identity, governed Effects, and confirmed wait/dispatch boundaries
 * OUTPUT: narrow correlation and optional payload-free presentation phases
 * POS:    core/observability — in-memory linkage only; no authority, payload, or persistence ownership
 */
import type { ToolInvocationSnapshot } from "../agents/tool-invocation.ts";

export interface ToolEffectObserver {
  /** Exact SDK invocation within its execution callback; absent outside that async scope. */
  currentInvocation?(): ToolInvocationSnapshot | undefined;
  bindEffect(input: { toolCallId: string; effectId: string }): void;
  phase?(input: { toolCallId: string; phase: "approval" | "executing" }): void;
}
