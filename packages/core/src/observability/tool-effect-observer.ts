/**
 * INPUT:  normalized AI SDK tool-call identity and a governed Core Effect identity
 * OUTPUT: narrow correlation contract shared by tool execution and Run observability
 * POS:    core/observability — in-memory linkage only; no authority, payload, or persistence ownership
 */
export interface ToolEffectObserver {
  bindEffect(input: { toolCallId: string; effectId: string }): void;
}
