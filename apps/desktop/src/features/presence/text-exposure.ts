/**
 * INPUT: one actual committed text DOM region and current source/window eligibility
 * OUTPUT: bounded exposure after half-region intersection for two continuous seconds
 * POS: ui/presence — disposable rendering evidence; never scrolls, focuses, opens or acknowledges reading
 */
interface ExposureInput {
  element: HTMLElement;
  changed(exposed: boolean): void;
  observer?: typeof IntersectionObserver;
}
export function observeTextExposure(input: ExposureInput) {
  let enabled = false;
  let visible = false;
  let exposed = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reset = () => {
    clearTimeout(timer); timer = undefined;
    if (exposed) { exposed = false; input.changed(false); }
  };
  const qualify = () => {
    if (disposed || !enabled || !visible) { reset(); return; }
    if (timer || exposed) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!disposed && enabled && visible && input.element.isConnected && input.element.textContent?.trim()) {
        exposed = true; input.changed(true);
      }
    }, 2_000);
  };
  const Observer = input.observer ?? globalThis.IntersectionObserver;
  const observer = typeof Observer === "function" ? new Observer((entries) => {
    if (disposed) return;
    const entry = entries.findLast((item) => item.target === input.element);
    if (!entry) return;
    visible = entry.isIntersecting && entry.intersectionRatio >= 0.5
      && entry.boundingClientRect.width > 0 && entry.boundingClientRect.height > 0;
    qualify();
  }, { threshold: [0, 0.5, 1] }) : null;
  observer?.observe(input.element);
  return {
    setEnabled(value: boolean) { enabled = value; qualify(); },
    dispose() { disposed = true; reset(); observer?.disconnect(); },
  };
}
