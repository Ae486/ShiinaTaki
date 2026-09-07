/**
 * INPUT:  one Pet client generation, actual visibility and the existing shared presentation gate
 * OUTPUT: raw tool facts immediately and identity-safe gated language, plus read-only reopening recovery
 * POS:    ui/chat-bubble — disposable adapter over shared activity; neither observation nor cleanup executes/cancels tools
 */
import { createChatActivityRecovery, type ChatActivityClient, type ChatActivityRecovery } from "@/lib/chat-activity-recovery.js";
import { activityMessageId, type ChatActivityView } from "@/lib/chat-activity-state.js";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import type { ConnectionGenerationContext } from "@/lib/connection-generation-controller.js";
import { sharedPresentationGate, type PresentationGate } from "@/lib/presentation-gate.js";
import { useChatBubbleStore } from "./chat-bubble-store.ts";
import { bubbleVisibility, type BubbleVisibilitySource } from "./bubble-visibility.ts";

export interface BubbleActivityBinding {
  restore(): Promise<void>;
  refresh(): Promise<void>;
  ownsMessage(messageId: string): boolean;
  dispose(): void;
}
interface BindingInput {
  client: ChatActivityClient;
  context: ConnectionGenerationContext;
  gate?: PresentationGate;
  visibility?: BubbleVisibilitySource;
}
interface BindingState {
  input: BindingInput;
  gate: PresentationGate;
  visibility: BubbleVisibilitySource;
  latest: ChatActivityView | null;
  epoch: number;
  disposed: boolean;
}

let currentBinding: BubbleActivityBinding | null = null;

export async function restoreBubbleActivity(client: ChatActivityClient, context: ConnectionGenerationContext): Promise<void> {
  currentBinding?.dispose();
  const binding = createBubbleActivityBinding({ client, context });
  currentBinding = binding;
  try { await binding.restore(); }
  catch (cause) { binding.dispose(); if (currentBinding === binding) currentBinding = null; throw cause; }
}

export function bubbleActivityOwnsMessage(messageId: string): boolean {
  return currentBinding?.ownsMessage(messageId) ?? false;
}

export function createBubbleActivityBinding(input: BindingInput): BubbleActivityBinding {
  useChatBubbleStore.getState().retirePresentation();
  const state: BindingState = { input, gate: input.gate ?? sharedPresentationGate,
    visibility: input.visibility ?? bubbleVisibility, latest: null, epoch: 0, disposed: false };
  const recovery = createChatActivityRecovery({ client: input.client, context: input.context, characterId: ACTIVE_CHARACTER_ID,
    onChange: (view) => observe(state, view) });
  const unwatch = state.visibility.subscribe(() => visibilityChanged(state, recovery));
  const dispose = () => {
    if (state.disposed) return;
    const store = useChatBubbleStore.getState();
    if (state.latest && store.activitySource === state.latest) store.observeActivity({ ...state.latest, stale: true });
    state.disposed = true; state.epoch += 1;
    recovery.dispose(); unwatch(); useChatBubbleStore.getState().retirePresentation();
  };
  input.client.onClose(dispose);
  return { restore: () => recovery.restore(), refresh: () => recovery.refresh(), dispose,
    ownsMessage: (messageId) => current(state) && !!state.latest && activityMessageId(state.latest.snapshot) === messageId };
}

function current(state: BindingState): boolean {
  return !state.disposed && state.input.context.isCurrent();
}

function observe(state: BindingState, view: ChatActivityView): void {
  if (!current(state)) return;
  state.latest = view;
  useChatBubbleStore.getState().observeActivity(view);
  if (state.visibility.visible()) present(state, view);
}

function present(state: BindingState, view: ChatActivityView): void {
  const epoch = state.epoch;
  state.gate.present(() => {
    if (!current(state) || !state.visibility.visible() || state.epoch !== epoch || state.latest !== view) return;
    useChatBubbleStore.getState().presentActivity(view);
  });
}

function visibilityChanged(state: BindingState, recovery: ChatActivityRecovery): void {
  if (!current(state)) return;
  state.epoch += 1;
  useChatBubbleStore.getState().retirePresentation();
  if (!state.visibility.visible()) return;
  if (state.latest) present(state, state.latest);
  void recovery.refresh().catch(() => undefined); // Recovery itself publishes stale truth on failure; no execution replay.
}
