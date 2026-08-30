/**
 * INPUT:  the trajectory ledger's content-change counter (mounted row count) from the controller's view state.
 * OUTPUT: useTrajectoryFollow(rowCount) -> { scrollRef, onScroll, following, resume } — bottom-pinning while the
 *         operator sits at the bottom; scrolling up pauses the follow, resume() scrolls back and re-pins.
 * POS:    ui/windows/home/pages/monitor — monitor-local scroll seam (DOM-only). Deliberately NOT the shared
 *         use-timeline-scroll: chat's hook carries the prepend-hold + top-reach loadOlder machinery (firstSeq,
 *         hasMore, loadOlder, in-flight length) the ledger does not have, and chat never renders its paused state.
 *         Extraction waits for a genuine third consumer (reactive-read-models.md §f).
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

const NEAR_BOTTOM_PX = 48;

export interface TrajectoryFollow {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  /** false = the operator scrolled away from the bottom and live rows no longer move the view. This is the user's
   *  own scroll position, never a synthetic state — the resume affordance renders only while it is false. */
  following: boolean;
  resume: () => void;
}

export function useTrajectoryFollow(rowCount: number): TrajectoryFollow {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [following, setFollowing] = useState(true);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = atBottom;
    setFollowing(atBottom); // same-value setState is a React no-op, so scrolling stays cheap
  };

  // Follow live appends down only while at-bottom; otherwise hold the operator's reading position. The effect keys
  // on row count alone — opening the inspector (or any layout change) does not run it, so it never fights the follow.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [rowCount]);

  const resume = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setFollowing(true);
  };

  return { scrollRef, onScroll, following, resume };
}
