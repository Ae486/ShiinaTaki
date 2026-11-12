/**
 * INPUT:  one toast's expiry callback and independent pointer/focus/reading pause reasons.
 * OUTPUT: a six-second remaining-time deadline, explicitly started/stopped with its mounted owner.
 * POS:    Toast presentation lifetime only; timers never fetch data or retain a dismissed event.
 */

export const AUTO_DISMISS_MS = 6_000;
type PauseReason = "pointer" | "focus";

export function createToastLifetime(expire: () => void) {
  let remaining = AUTO_DISMISS_MS;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held = false;
  let active = false;
  const reasons = new Set<PauseReason>();

  const stopTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  };
  const arm = (): void => {
    if (!active || held || reasons.size > 0 || timer !== null) return;
    startedAt = Date.now();
    timer = setTimeout(() => { timer = null; remaining = 0; expire(); }, remaining);
  };

  return {
    start(): void { active = true; arm(); },
    stop(): void { active = false; stopTimer(); },
    pause(reason: PauseReason): void { reasons.add(reason); stopTimer(); },
    resume(reason: PauseReason): void { reasons.delete(reason); arm(); },
    // A4 deliberate click/keyboard activation holds the notice until explicit dismissal.
    hold(): void { held = true; stopTimer(); },
  };
}
