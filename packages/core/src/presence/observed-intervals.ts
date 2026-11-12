/**
 * INPUT: bounded half-open Core-time evidence intervals
 * OUTPUT: canonical unions and intersections without filling unobserved gaps
 * POS: core/presence — shared arithmetic for ephemeral sources and durable feedback
 */
export type ObservedInterval = readonly [start: number, end: number];

export function unionIntervals(intervals: readonly ObservedInterval[]): ObservedInterval[] {
  const sorted = intervals.filter(([start, end]) => Number.isFinite(start) && end > start)
    .toSorted((a, b) => a[0] - b[0]);
  const result: ObservedInterval[] = [];
  for (const [start, end] of sorted) {
    const previous = result.at(-1);
    if (previous && start <= previous[1]) result[result.length - 1] = [previous[0], Math.max(end, previous[1])];
    else result.push([start, end]);
  }
  return result;
}

export function intersectIntervals(interval: ObservedInterval, others: readonly ObservedInterval[]): ObservedInterval[] {
  return unionIntervals(others.map(([start, end]) => [Math.max(start, interval[0]), Math.min(end, interval[1])]));
}
