/**
 * INPUT: actual text content, committed row references and the current surface owner
 * OUTPUT: stable DOM ref with qualified viewport evidence and synchronous retirement
 * POS: ui/presence — mount beneath lazy content resolution; skeletons and live text have no committed target
 */
import { useContext, useLayoutEffect, useRef } from "react";
import { CommittedExposureContext } from "./committed-exposure-context.ts";
import type { CommittedTextTarget } from "./surface-presence.ts";
import { observeTextExposure } from "./text-exposure.ts";

export function useCommittedExposure(targets: readonly CommittedTextTarget[], text: string, active = true) {
  const source = useContext(CommittedExposureContext);
  const ref = useRef<HTMLDivElement>(null);
  const key = targets.map((target) => `${target.characterId}:${target.timelineSeq}`).join("|");
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !source || !active || !text.trim() || targets.length === 0) return;
    const owner = {};
    const exposure = observeTextExposure({ element, changed: (value) => targets.forEach((target) => source.expose(target, value, owner)) });
    const update = () => exposure.setEnabled(source.eligible());
    const unsubscribe = source.subscribe(update);
    update();
    return () => { unsubscribe(); exposure.dispose(); };
    // Stable row coordinates, rather than a freshly projected array, own the observation lifetime.
  }, [source, key, text, active]);
  return ref;
}
