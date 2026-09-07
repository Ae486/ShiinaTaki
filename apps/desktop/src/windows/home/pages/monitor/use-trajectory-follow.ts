/**
 * INPUT:  measurable ledger items, bounded older-page actions, and explicit inspection/range suspension
 * OUTPUT: measured virtualization, stable prepend anchors, initial tail placement, and deliberate follow control
 * POS:    ui/monitor — DSH Table scroll adaptation; see third-party-notices.md (DeepSeek MIT); no polling
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LedgerItem } from "./trajectory-layout.ts";
import {
  focusRecord, holdAnchor, onLedgerScroll, pauseFollowing, positionLedgerRows, requestOlderPage, resumeFollowing,
  type LedgerPosition, type LedgerPositionContext,
} from "./trajectory-scroll.ts";

export interface LedgerHistory {
  hasOlder: boolean;
  loading: boolean;
  load(): Promise<void>;
}
export interface LedgerHandle {
  holdAnchor(): void;
  focusRecord(key: string): void;
  resume(): void;
}
export interface FollowInput { items: readonly LedgerItem[]; history: LedgerHistory; suspended: boolean; active: boolean }

export function useTrajectoryFollow(input: FollowInput) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const position = useRef<LedgerPosition>({ initialized: false, following: true, requesting: false, count: 0 });
  const [following, setFollowing] = useState(true);
  const [ready, setReady] = useState(false);
  const enabled = input.items.length > 100;
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const estimateSize = useCallback((index: number) => input.items[index]?.height ?? 30, [input.items]);
  const getItemKey = useCallback((index: number) => input.items[index]?.key ?? index, [input.items]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: enabled ? input.items.length : 0, enabled, getScrollElement, estimateSize, getItemKey,
    initialOffset: () => scrollRef.current?.scrollTop ?? 0,
    initialRect: { width: 0, height: 600 }, anchorTo: "end", overscan: 12,
    scrollMargin: input.history.hasOlder ? 30 : 0, scrollEndThreshold: 2,
  });
  const context: LedgerPositionContext = { input, pane: scrollRef, virtualizer, enabled, state: position.current, setFollowing, setReady };
  useLayoutEffect(() => positionLedgerRows(context));
  useLayoutEffect(() => { if (input.suspended) pauseFollowing(context); }, [input.suspended]);
  useSelectionSuspension(scrollRef, () => { if (input.active) pauseFollowing(context); });
  return {
    scrollRef, following, ready, enabled, virtualizer,
    onScroll: () => onLedgerScroll(context), loadOlder: () => requestOlderPage(context),
    holdAnchor: () => holdAnchor(context), focusRecord: (key: string) => focusRecord(context, key),
    resume: () => resumeFollowing(context),
  };
}

function useSelectionSuspension(pane: { current: HTMLDivElement | null }, pauseFollow: () => void): void {
  const latest = useRef(pauseFollow);
  latest.current = pauseFollow;
  useEffect(() => {
    const changed = () => {
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed && pane.current?.contains(selection.anchorNode)) latest.current();
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [pane]);
}
