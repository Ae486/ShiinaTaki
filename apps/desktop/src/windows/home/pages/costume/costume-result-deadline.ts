/**
 * INPUT:  one pending costume id, the Home window's last-good timing accessor, and its timeout callback.
 * OUTPUT: startCostumeResultDeadline() -> cancellation callback for one captured cross-window result deadline.
 * POS:    ui/windows/home/pages/costume — framework-free timer seam; client generations cannot restart an attempt.
 */

import type { TimingPolicy } from "@taki/shared";

export function startCostumeResultDeadline(
  costumeId: string,
  currentTimingPolicy: () => TimingPolicy,
  onTimeout: (costumeId: string) => void,
): () => void {
  const deadlineMs = currentTimingPolicy().homeResultMs;
  const timer = setTimeout(() => onTimeout(costumeId), deadlineMs);
  return () => clearTimeout(timer);
}
