/**
 * INPUT:  a loaded model's internalModel (motionManager, parallelMotionManager, extendParallelMotionManager) + a
 *         LayeredMotionRequest from the motion panel.
 * OUTPUT: ensureChannels(internal, n) (idempotent grow-only); playLayered(internal, req) routing "primary" to
 *         motionManager.startMotion and channel n to parallelMotionManager[n].startMotion — the ONLY two engine entry
 *         points that accept ignoreParamIds (model.motion() has none); invalidateMotion(manager, group, index) resets a
 *         cached motion slot to undefined so a filtered play stops leaking into later unfiltered plays.
 * POS:    experimental / lab — not in production path; structural engine inputs, no engine value imports.
 */

export interface LayeredMotionRequest {
  group: string;
  index: number;
  priority: 0 | 1 | 2 | 3;
  loop?: boolean;
  channel: "primary" | number;
  ignoreParamIds: string[];
}

interface StartOptions {
  ignoreParamIds?: string[];
  loop?: boolean;
}

export interface ChannelManager {
  startMotion(group: string, index: number, priority: number, options: StartOptions): Promise<boolean>;
}

export interface LayeredInternal {
  motionManager: ChannelManager;
  parallelMotionManager: ChannelManager[];
  extendParallelMotionManager(managerCount: number): void;
}

export function ensureChannels(internal: Pick<LayeredInternal, "parallelMotionManager" | "extendParallelMotionManager">, n: number): void {
  if (internal.parallelMotionManager.length < n) internal.extendParallelMotionManager(n);
}

export function playLayered(internal: LayeredInternal, req: LayeredMotionRequest): Promise<boolean> {
  const options: StartOptions = { ignoreParamIds: req.ignoreParamIds, loop: req.loop };
  if (req.channel === "primary") return internal.motionManager.startMotion(req.group, req.index, req.priority, options);
  ensureChannels(internal, req.channel + 1);
  const channel = internal.parallelMotionManager[req.channel];
  if (channel === undefined) return Promise.resolve(false);
  return channel.startMotion(req.group, req.index, req.priority, options);
}

// `null` means "load failed" to loadMotion and is never retried; `undefined` makes the next play reload from disk.
export function invalidateMotion(manager: { motionGroups: Partial<Record<string, unknown[]>> }, group: string, index: number): void {
  const slots = manager.motionGroups[group];
  if (slots === undefined || index >= slots.length) return;
  slots[index] = undefined;
}
