/**
 * INPUT:  an optional data-free observer of an already committed Perception source change
 * OUTPUT: best-effort synchronous observation without changing the producer's outcome
 * POS:    core/perception — shared notification boundary for activity, scheduling and pause producers
 */
export function notifyPerceptionChange(onChange?: () => void): void {
  try {
    onChange?.();
  } catch {
    // An observer can retire independently of the source. Neither its failure nor its possible private error text
    // may turn a committed sample, scheduling change or durable privacy write into a failed source operation.
  }
}
