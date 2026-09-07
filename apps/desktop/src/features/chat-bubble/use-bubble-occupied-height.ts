/**
 * INPUT:  one presence group's natural content box and finite removal identity
 * OUTPUT: CSS height targets measured from natural content, with guarded zero-space cleanup
 * POS:    ui/chat-bubble — bounded geometry observation; the animated outer box is never measured each frame
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BubblePresenceGroup } from "./bubble-presence.ts";
import { observeBubbleCssCompletion } from "./bubble-css-completion.ts";

interface HeightInput {
  group: BubblePresenceGroup;
  onMeasured(): void;
  onEmpty(groupKey: string, revision: number): void;
}

export function useBubbleOccupiedHeight(input: HeightInput) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const naturalRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef(input);
  latest.current = input;
  const [height, setHeight] = useState<number | null>(input.group.instant ? null : 0);
  const measure = useCallback((observed?: number) => {
    const natural = naturalRef.current;
    if (!natural) return;
    setHeight(observed ?? natural.getBoundingClientRect().height);
  }, []);
  useLayoutEffect(() => { measure(); }, [input.group.revision, input.group.instant, measure]);
  // A natural target is known before its animated height exists in the scroll range. Bootstrap tail following
  // again at CSS settlement, including cancelled/zero motion; an anchor alone cannot start from scrollTop zero.
  useLayoutEffect(() => {
    latest.current.onMeasured();
    const outer = outerRef.current;
    if (outer) return observeBubbleCssCompletion(outer, () => latest.current.onMeasured());
  }, [height, input.group.instant]);
  useEffect(() => {
    const natural = naturalRef.current;
    if (!natural || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(natural);
    return () => observer.disconnect();
  }, [measure]);
  const empty = input.group.rows.every((row) => row.phase === "exiting");
  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer || !empty || height !== 0) return;
    return observeBubbleCssCompletion(outer, () => input.onEmpty(input.group.key, input.group.revision));
  }, [empty, height, input.group.key, input.group.revision, input.onEmpty]);
  return { outerRef, naturalRef, height };
}
