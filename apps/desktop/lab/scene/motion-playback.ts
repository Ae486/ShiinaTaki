/**
 * INPUT:  a loaded model's channel managers, generation and diagnostic sink.
 * OUTPUT: scene-owned playback with C2 finish-event replay loops, C3 native looping, and cancellation on stop/disposal.
 * POS:    experimental / lab — not in production path; no engine value imports or production behavior changes.
 */

import { type ChannelManager, ensureChannels, type LayeredMotionRequest, playLayered } from "./layered-motion.ts";
import type { Generation } from "./param-access.ts";

export interface PlaybackManager extends ChannelManager {
  destroyed: boolean;
  isFinished(): boolean;
  stopAllMotions(): void;
  on(event: "motionFinish", listener: () => void): unknown;
  off(event: "motionFinish", listener: () => void): unknown;
}

interface PlaybackInternal {
  motionManager: PlaybackManager;
  parallelMotionManager: PlaybackManager[];
  extendParallelMotionManager(count: number): void;
}

export interface MotionPlayback {
  play(request: LayeredMotionRequest): Promise<boolean>;
  stopAll(): void;
  dispose(): void;
}

interface ChannelPlayback {
  manager: PlaybackManager;
  revision: number;
  request: LayeredMotionRequest | null;
  busy: boolean;
  tail: Promise<unknown>;
  finish: () => void;
}

export function createMotionPlayback(internal: PlaybackInternal, generation: Generation, log: (line: string) => void): MotionPlayback {
  return new LabMotionPlayback(internal, generation, log);
}

class LabMotionPlayback implements MotionPlayback {
  private readonly channels = new Map<LayeredMotionRequest["channel"], ChannelPlayback>();
  private disposed = false;

  private readonly internal: PlaybackInternal;
  private readonly generation: Generation;
  private readonly log: (line: string) => void;

  constructor(internal: PlaybackInternal, generation: Generation, log: (line: string) => void) {
    this.internal = internal;
    this.generation = generation;
    this.log = log;
  }

  play(request: LayeredMotionRequest): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    const channel = this.channel(request.channel);
    if (channel === undefined || channel.manager.destroyed) return Promise.resolve(false);
    channel.revision += 1;
    channel.request = null;
    // Cancel a loading reservation before serializing the replacement. Late successful starts are stopped inside
    // perform() before the next request begins, including C2 IDLE starts whose engine reservation check is weaker.
    if (channel.busy) channel.manager.stopAllMotions();
    return this.enqueue(channel, { ...request, ignoreParamIds: [...request.ignoreParamIds] }, channel.revision);
  }

  stopAll(): void {
    for (const channel of this.channels.values()) {
      channel.revision += 1;
      channel.request = null;
    }
    for (const manager of [this.internal.motionManager, ...this.internal.parallelMotionManager]) {
      if (!manager.destroyed) manager.stopAllMotions();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
    for (const channel of this.channels.values()) channel.manager.off("motionFinish", channel.finish);
    this.channels.clear();
  }

  private channel(key: LayeredMotionRequest["channel"]): ChannelPlayback | undefined {
    const existing = this.channels.get(key);
    if (existing !== undefined) return existing;
    if (key !== "primary") ensureChannels(this.internal, key + 1);
    const manager = key === "primary" ? this.internal.motionManager : this.internal.parallelMotionManager[key];
    if (manager === undefined) return undefined;
    const channel: ChannelPlayback = { manager, revision: 0, request: null, busy: false, tail: Promise.resolve(), finish: () => this.replay(channel) };
    manager.on("motionFinish", channel.finish);
    this.channels.set(key, channel);
    return channel;
  }

  private enqueue(channel: ChannelPlayback, request: LayeredMotionRequest, revision: number): Promise<boolean> {
    const next = channel.tail.then(() => this.perform(channel, request, revision));
    channel.tail = next;
    return next;
  }

  private active(channel: ChannelPlayback, revision: number): boolean {
    return !this.disposed && !channel.manager.destroyed && channel.revision === revision;
  }

  private async perform(channel: ChannelPlayback, request: LayeredMotionRequest, revision: number): Promise<boolean> {
    if (!this.active(channel, revision)) return false;
    channel.busy = true;
    try {
      const started = await playLayered(this.internal, { ...request, loop: this.generation === "cubism3" && request.loop });
      if (!this.active(channel, revision)) {
        if (started && !channel.manager.destroyed) channel.manager.stopAllMotions();
        return false;
      }
      channel.request = started ? request : null;
      return started;
    } catch (error) {
      if (this.active(channel, revision)) this.log(`motion start failed: ${error instanceof Error ? error.message : String(error)}`);
      channel.request = null;
      return false;
    } finally {
      channel.busy = false;
    }
  }

  private replay(channel: ChannelPlayback): void {
    const request = channel.request;
    if (this.generation !== "cubism2" || !request?.loop || this.disposed) return;
    const revision = channel.revision;
    // Both managers emit motionFinish BEFORE state.complete(). Enqueueing starts in a microtask after the synchronous
    // engine update has cleared currentGroup/currentIndex, otherwise replay of the same motion is rejected.
    void this.enqueue(channel, request, revision).then((started) => {
      if (started) this.log(`lab C2 loop replay (${request.group},${request.index}) on ${request.channel}`);
    });
  }
}
