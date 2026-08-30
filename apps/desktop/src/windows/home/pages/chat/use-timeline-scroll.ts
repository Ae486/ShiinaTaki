/**
 * INPUT:  content-change counters (entries/in-flight/oldest seq) + hasMore + loadOlder from the timeline hook.
 * OUTPUT: useTimelineScroll(...) -> { scrollRef, onScroll }: auto-stick-to-bottom, top-reach loads older, and holds
 *         the reading position when an older page prepends.
 * POS:    ui/windows/home/pages/chat — the scroll-behavior seam kept out of TimelineView (DOM-only; not the render contract).
 */

import { useLayoutEffect, useRef, type RefObject } from "react";

const NEAR_EDGE_PX = 48;
const LOAD_BACKSTOP_MS = 2_000;

export interface TimelineScrollInput {
  entryCount: number;
  /** Oldest mounted seq: a prepended older page LOWERS it. The landed-prepend signal survives the P1b window trim,
   *  where a prepend and its trim cancel out in entryCount. */
  firstSeq: number | null;
  inflightLen: number; // -1 when no in-flight row, so a clear still changes the value and re-runs the effect
  hasMore: boolean;
  loadOlder: () => void;
}

export interface TimelineScroll {
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

export function useTimelineScroll(input: TimelineScrollInput): TimelineScroll {
  const { entryCount, firstSeq, inflightLen, hasMore, loadOlder } = input;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const loadEpochRef = useRef(0);
  const prevHeightRef = useRef(0);
  const prevFirstSeqRef = useRef<number | null>(firstSeq);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_EDGE_PX;
    if (el.scrollTop < NEAR_EDGE_PX && hasMore && !loadingOlderRef.current) {
      loadingOlderRef.current = true;
      prevHeightRef.current = el.scrollHeight;
      loadOlder();
      // Backstop: a page that the P1b cap fully trims renders nothing (no firstSeq/entryCount change, so the
      // layout effect below never runs and would leave the guard stuck). Re-arm auto-load after a bounded
      // wait; the effect's prepend clear invalidates this epoch, so the normal path is unaffected. A duplicate
      // load inside the window is harmless — the store dedups by seq.
      const epoch = ++loadEpochRef.current;
      window.setTimeout(() => {
        if (loadEpochRef.current === epoch) loadingOlderRef.current = false;
      }, LOAD_BACKSTOP_MS);
    }
  };

  // On an OLDER page (firstSeq lowered while a load was pending) hold the reading position — content changed above
  // the viewport (added page minus the P1b trim sliding out the oldest rows). Otherwise, if the user sits at the
  // bottom, follow new rows / coalesced streaming updates down.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prepended = firstSeq !== null && (prevFirstSeqRef.current === null || firstSeq < prevFirstSeqRef.current);
    prevFirstSeqRef.current = firstSeq;
    if (loadingOlderRef.current && prepended) {
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
      loadingOlderRef.current = false;
      loadEpochRef.current += 1; // invalidate the backstop timer — the prepend handled the settle
    } else if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entryCount, firstSeq, inflightLen]);

  return { scrollRef, onScroll };
}
