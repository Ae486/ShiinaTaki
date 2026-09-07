/**
 * INPUT:  measured ledger geometry, stable item identities, and explicit reader/navigation state
 * OUTPUT: bounded page requests and deterministic tail/anchor/focus placement without content-frame scrolling
 * POS:    ui/monitor — imperative scroll boundary separated from React; see third-party-notices.md (DeepSeek MIT)
 */
import type { Virtualizer } from "@tanstack/react-virtual";
import type { FollowInput } from "./use-trajectory-follow.ts";

interface Anchor { key: string; offset: number }
export interface LedgerPosition {
  initialized: boolean; following: boolean; requesting: boolean; count: number;
  first?: string; last?: string; anchor?: Anchor; focus?: string;
}
export interface LedgerPositionContext {
  input: FollowInput;
  pane: { current: HTMLDivElement | null };
  virtualizer: Pick<Virtualizer<HTMLDivElement, HTMLDivElement>, "scrollToEnd" | "getOffsetForIndex" | "scrollToOffset" | "scrollToIndex">;
  enabled: boolean;
  state: LedgerPosition;
  setFollowing(value: boolean): void;
  setReady(value: boolean): void;
}

export function pauseFollowing(context: LedgerPositionContext): void {
  context.state.following = false;
  context.setFollowing(false);
}

export function resumeFollowing(context: LedgerPositionContext): void {
  if (!context.input.active) return;
  context.state.anchor = undefined;
  context.state.focus = undefined;
  context.state.following = true;
  context.setFollowing(true);
  scrollToEnd(context);
}

function scrollToEnd(context: LedgerPositionContext): void {
  if (context.enabled) context.virtualizer.scrollToEnd({ behavior: "auto" });
  else if (context.pane.current) context.pane.current.scrollTop = context.pane.current.scrollHeight;
}

export function holdAnchor(context: LedgerPositionContext): void {
  const pane = context.pane.current;
  if (!pane || !context.input.active) return;
  pauseFollowing(context);
  const top = pane.getBoundingClientRect().top;
  const first = [...pane.querySelectorAll<HTMLElement>("[data-ledger-key]")]
    .find((element) => element.getBoundingClientRect().bottom > top + 1);
  if (first?.dataset.ledgerKey) context.state.anchor = { key: first.dataset.ledgerKey, offset: first.getBoundingClientRect().top - top };
}

function renderedRecord(context: LedgerPositionContext, key: string): HTMLElement | undefined {
  return [...(context.pane.current?.querySelectorAll<HTMLElement>("[data-ledger-key]") ?? [])]
    .find((element) => element.dataset.ledgerKey === key);
}

function restoreAnchor(context: LedgerPositionContext, anchor: Anchor): void {
  const pane = context.pane.current;
  const index = context.input.items.findIndex((item) => item.key === anchor.key);
  if (!pane || index < 0) return;
  if (context.enabled) {
    const offset = context.virtualizer.getOffsetForIndex(index, "start")?.[0];
    if (offset !== undefined) context.virtualizer.scrollToOffset(Math.max(0, offset - anchor.offset), { behavior: "auto" });
  } else {
    const element = renderedRecord(context, anchor.key);
    if (element) pane.scrollTop += element.getBoundingClientRect().top - pane.getBoundingClientRect().top - anchor.offset;
  }
}

export function positionLedgerRows(context: LedgerPositionContext): void {
  const { state, input } = context;
  if (!context.pane.current || !input.active) return;
  const first = input.items[0]?.key;
  const last = input.items.at(-1)?.key;
  const changed = state.first !== first || state.last !== last || state.count !== input.items.length;
  if (!state.initialized) {
    state.initialized = true;
    scrollToEnd(context);
    context.setReady(true);
  } else if (state.anchor && changed) {
    restoreAnchor(context, state.anchor);
    if (!state.requesting && !input.history.loading) state.anchor = undefined;
    pauseFollowing(context);
  } else if (changed && state.following && !input.suspended
    && input.items.length > state.count && last !== state.last) scrollToEnd(context);
  if (state.anchor && !state.requesting && !input.history.loading && !changed) state.anchor = undefined;
  state.first = first; state.last = last; state.count = input.items.length;
  if (state.focus) {
    const element = renderedRecord(context, state.focus);
    if (element) { element.focus({ preventScroll: true }); state.focus = undefined; }
  }
}

export function onLedgerScroll(context: LedgerPositionContext): void {
  const pane = context.pane.current;
  if (!pane || !context.state.initialized || !context.input.active) return;
  if (pane.scrollHeight - pane.clientHeight - pane.scrollTop > 2) pauseFollowing(context);
  if (pane.scrollTop <= 48) requestOlderPage(context);
}

export function requestOlderPage(context: LedgerPositionContext): void {
  if (!context.input.active || !context.input.history.hasOlder || context.input.history.loading || context.state.requesting) return;
  holdAnchor(context);
  context.state.requesting = true;
  // The controller surfaces read failures and always settles this promise; a page failure cannot leave a stuck hold.
  void context.input.history.load().finally(() => { context.state.requesting = false; });
}

export function focusRecord(context: LedgerPositionContext, key: string): void {
  const pane = context.pane.current;
  const index = context.input.items.findIndex((item) => item.key === key);
  if (!pane || index < 0 || !context.input.active) return;
  pauseFollowing(context);
  context.state.focus = key;
  if (context.enabled) context.virtualizer.scrollToIndex(index, { align: "center", behavior: "auto" });
  else {
    const element = renderedRecord(context, key);
    if (element) {
      pane.scrollTop += element.getBoundingClientRect().top - pane.getBoundingClientRect().top
        - pane.clientHeight / 2 + element.clientHeight / 2;
      element.focus({ preventScroll: true });
      context.state.focus = undefined;
    }
  }
}
