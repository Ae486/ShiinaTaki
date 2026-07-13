/**
 * INPUT:  avatar lifecycle events (think/work/rest/sleep/wake) dispatched from the UI store.
 * OUTPUT: pure idle/thinking/working/sleeping transitions + the render-activity tier each state implies.
 * POS:    ui/renderer — framework-free FSM (ZERO React imports), UI-local (no LLM/token cost); mirrored into
 *         avatar-store for React display and read by the render governor. Real WS-driven events land in #16.
 */

export type AvatarState = "idle" | "thinking" | "working" | "sleeping";

export type AvatarEvent = "think" | "work" | "rest" | "sleep" | "wake";

/** How hard the renderer should run for a given avatar state (consumed by the render governor). */
export type RenderActivity = "active" | "idle" | "asleep";

// Transitions omitted from a state are no-ops (the state is returned unchanged), e.g. you must `wake` a
// sleeping avatar before it can think again. This keeps the machine total and predictable to test.
const TRANSITIONS: Record<AvatarState, Partial<Record<AvatarEvent, AvatarState>>> = {
  idle: { think: "thinking", work: "working", sleep: "sleeping" },
  thinking: { work: "working", rest: "idle", sleep: "sleeping" },
  working: { think: "thinking", rest: "idle", sleep: "sleeping" },
  sleeping: { wake: "idle" },
};

const ACTIVITY: Record<AvatarState, RenderActivity> = {
  idle: "idle",
  thinking: "active",
  working: "active",
  sleeping: "asleep",
};

export function nextAvatarState(current: AvatarState, event: AvatarEvent): AvatarState {
  return TRANSITIONS[current][event] ?? current;
}

export function renderActivityFor(state: AvatarState): RenderActivity {
  return ACTIVITY[state];
}
