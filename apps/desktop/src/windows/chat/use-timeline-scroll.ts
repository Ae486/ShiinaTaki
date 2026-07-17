/**
 * INPUT:  content-change counters (entries/in-flight) + hasMore + a loadOlder callback from the timeline hook.
 * OUTPUT: useTimelineScroll(...) -> { scrollRef, onScroll }: auto-stick-to-bottom, top-reach loads older, and holds
 *         the reading position when an older page prepends.
 * POS:    ui/windows/chat — the scroll-behavior seam kept out of TimelineView (DOM-only; not the render contract).
 */

import { useLayoutEffect, useRef, type RefObject } from "react";

const NEAR_EDGE_PX = 48;

export interface TimelineScrollInput {
  entryCount: number;
  inflightLen: number; // -1 when no in-flight row, so a clear still changes the value and re-runs the effect
  hasMore: boolean;
  loadOlder: () => void;
}

export interface TimelineScroll {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

export function useTimelineScroll(input: TimelineScrollInput): TimelineScroll {
  const { entryCount, inflightLen, hasMore, loadOlder } = input;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const prevHeightRef = useRef(0);
  const prevEntryCountRef = useRef(entryCount);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_EDGE_PX;
    if (el.scrollTop < NEAR_EDGE_PX && hasMore && !loadingOlderRef.current) {
      loadingOlderRef.current = true;
      prevHeightRef.current = el.scrollHeight;
      loadOlder();
    }
  };

  // On an OLDER page (entryCount grew while a load was pending) hold the reading position — content grew above the
  // viewport. Otherwise, if the user sits at the bottom, follow new rows / streaming deltas down.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = entryCount > prevEntryCountRef.current;
    prevEntryCountRef.current = entryCount;
    if (loadingOlderRef.current && grew) {
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
      loadingOlderRef.current = false;
    } else if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entryCount, inflightLen]);

  return { scrollRef, onScroll };
}
