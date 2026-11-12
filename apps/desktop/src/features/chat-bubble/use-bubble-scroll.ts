/**
 * INPUT:  the current visible transcript identity and natural-content size changes
 * OUTPUT: event-driven tail following that pauses for reading/selection and delegates intermediate geometry to CSS anchoring
 * POS:    ui/chat-bubble — viewport ownership only; no animated-box observation, timer or repeated smooth scrolling
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

function selected(element: HTMLElement): boolean {
  const selection = element.ownerDocument.getSelection();
  return !!selection && !selection.isCollapsed
    && (element.contains(selection.anchorNode) || element.contains(selection.focusNode));
}

export function useBubbleScroll(transcriptKey: string) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const onMeasured = useCallback(() => {
    const element = scrollRef.current;
    if (element && followingRef.current && !selected(element)) element.scrollTop = element.scrollHeight;
  }, []);
  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    followingRef.current = !selected(element) && element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    setFollowing(followingRef.current);
  }, []);
  useLayoutEffect(() => {
    followingRef.current = true; setFollowing(true);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    onMeasured();
  }, [transcriptKey, onMeasured]);
  useEffect(() => {
    const changed = () => {
      if (scrollRef.current && selected(scrollRef.current)) { followingRef.current = false; setFollowing(false); }
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, []);
  return { scrollRef, following, onScroll, onMeasured };
}
