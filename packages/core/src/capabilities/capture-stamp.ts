/**
 * INPUT:  the wall clock, read once per call
 * OUTPUT: captureStamp() -> ISO-8601 UTC string — the moment a state-snapshot tool actually observed the system
 * POS:    core/capabilities — Q5 (batch 6): state-snapshot results (screenshot describe / process list / clipboard
 *         read; the time tool stamps inline off its own Date) persist into replay and go stale — the stamp is
 *         written ONCE at capture, rides the persisted tool-result row byte-stable, and batch 7's fold traces read it
 */
export function captureStamp(): string {
  return new Date().toISOString();
}
