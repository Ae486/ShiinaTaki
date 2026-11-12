/**
 * INPUT:  CSS-owned finite transitions/animations on one exact element
 * OUTPUT: cancellable completion observation, including zero duration and missing DOM end events
 * POS:    ui/chat-bubble — observes browser animation promises only; never starts JS animation timers or frame loops
 */
export function observeBubbleCssCompletion(element: Element, settled: () => void): () => void {
  let active = true;
  const animations = typeof element.getAnimations === "function" ? element.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY) : [];
  void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
    if (active) settled();
  });
  return () => { active = false; };
}
