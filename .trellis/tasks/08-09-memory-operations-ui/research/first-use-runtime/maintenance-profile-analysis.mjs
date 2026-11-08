/** Sample-weighted analysis, independent of replay/service startup. No source text or model values are read. */
export function profileAnalysis(profile, window) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const frames = new Map();
  const frame = (id) => {
    if (!frames.has(id)) {
      const value = nodes.get(id).callFrame;
      // V8 may expose dynamically compiled script URLs. Keep file/frame identifiers only.
      frames.set(id, `${value.functionName || '(anonymous)'} (${value.url.startsWith('data:') ? '[dynamic script]' : value.url}:${value.lineNumber + 1})`);
    }
    return frames.get(id);
  };
  const lower = window?.startMs ?? 0;
  const upper = window?.endMs ?? (profile.endTime - profile.startTime) / 1000;
  const self = new Map();
  const total = new Map();
  const stretches = [];
  let stretch;
  let elapsed = 0;
  let sampledMs = 0;
  const add = (map, key, ms) => map.set(key, (map.get(key) ?? 0) + ms);
  const chain = (id) => {
    const result = [];
    for (let current = id; current !== undefined; current = parents.get(current)) result.push(current);
    return result;
  };
  const endStretch = () => { if (stretch) stretches.push(stretch); stretch = undefined; };
  if (!profile.timeDeltas || profile.timeDeltas.length !== profile.samples?.length) {
    return { status: "UNKNOWN", reason: "Missing or mismatched sample time deltas" };
  }
  for (let i = 0; i < profile.samples.length; i++) {
    const previous = elapsed; elapsed += profile.timeDeltas[i] / 1000;
    const from = Math.max(previous, lower); const to = Math.min(elapsed, upper);
    if (to <= from) continue;
    const ms = to - from; const id = profile.samples[i];
    sampledMs += ms;
    add(self, frame(id), ms);
    for (const name of new Set(chain(id).map(frame))) add(total, name, ms);
    if (nodes.get(id).callFrame.functionName === "(idle)") endStretch();
    else {
      stretch ??= { startMs: from, durationMs: 0, stacks: new Map() };
      stretch.durationMs += ms;
      add(stretch.stacks, id, ms);
    }
  }
  endStretch();
  const top = (map, count) => [...map].sort((a, b) => b[1] - a[1]).slice(0, count);
  return { status: "sampled", sampledMs, profileDurationMs: (profile.endTime - profile.startTime) / 1000,
    windowOffsetsMs: { start: lower, end: upper },
    topSelf: top(self, 25).map(([frame, ms]) => ({ frame, ms })),
    topTotal: top(total, 25).map(([frame, ms]) => ({ frame, ms })),
    longestBusy: stretches.sort((a, b) => b.durationMs - a.durationMs).slice(0, 5).map((value) => ({
      startMs: value.startMs, startAt: window?.epochMs === undefined ? "UNKNOWN" : new Date(window.epochMs + value.startMs).toISOString(),
      durationMs: value.durationMs,
      stacks: top(value.stacks, 3).map(([id, ms]) => ({ ms, frames: chain(id).reverse().map(frame) })),
    })),
    meaning: "timeDeltas-weighted sampled wall time; total deduplicates recursive frames; busy means contiguous non-idle samples, not measured OS CPU occupancy",
  };
}
