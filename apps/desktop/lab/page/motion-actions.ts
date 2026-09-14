/**
 * INPUT:  LabScene + LogLine + a reader of the motion panel's current selection (group/index/priority/loop/channel/
 *         ignore toggles).
 * OUTPUT: createMotionActions(scene, log, read) -> { play, stopAll, invalidate }: play derives the ignore set from the
 *         costume's face params and routes through playLayered (logging the cache mutation on filtered plays); stopAll
 *         stops primary + parallel channels; invalidate resets the selected motion's cache slot.
 * POS:    experimental / lab — not in production path; the motion panel's behaviour, split from its DOM builder.
 */

import { deriveFaceSet } from "../scene/face-params.ts";
import type { LabScene } from "../scene/lab-scene.ts";
import { invalidateMotion, type LayeredMotionRequest } from "../scene/layered-motion.ts";
import { createMotionPlayback, type MotionPlayback } from "../scene/motion-playback.ts";
import type { LogLine } from "./controls.ts";

export interface MotionSelection {
  group: string;
  index: number;
  priority: LayeredMotionRequest["priority"];
  loop: boolean;
  channel: LayeredMotionRequest["channel"];
  ignoreFace: boolean;
  ignoreEyeOpenMult: boolean;
}

export interface MotionActions {
  play(): Promise<void>;
  stopAll(): void;
  invalidate(): void;
}

export function createMotionActions(scene: LabScene, log: LogLine, read: () => MotionSelection | null): MotionActions {
  let playback: MotionPlayback | null = null;
  scene.onBeforeDispose(() => { playback?.dispose(); playback = null; });
  scene.onModel((ctx) => { playback = createMotionPlayback(ctx.internal, ctx.facts.generation, log); });
  return {
    async play() {
      const ctx = scene.current;
      const picked = read();
      const player = playback;
      if (ctx === null || picked === null || player === null) return;
      const ignoreParamIds = picked.ignoreFace ? deriveFaceSet(ctx.facts.faceSet, { excludeMult: !picked.ignoreEyeOpenMult }) : [];
      const { group, index, priority, loop, channel } = picked;
      const req: LayeredMotionRequest = { group, index, priority, loop, channel, ignoreParamIds };
      const started = await player.play(req);
      if (scene.current !== ctx || player !== playback) return;
      log(`play ${describe(req)} -> ${started}`);
      if (started && loop) log(`loop mode: ${ctx.facts.generation === "cubism2" ? "lab C2 finish-event replay" : "C3 native"}`);
      if (started && ignoreParamIds.length > 0) {
        log(`motion (${req.group},${req.index}) now filtered — cache mutated (${ignoreParamIds.length} ids)`);
      }
    },
    stopAll() {
      const internal = scene.current?.internal;
      if (internal === undefined) return;
      playback?.stopAll();
      log(`stopAllMotions() primary + ${internal.parallelMotionManager.length} parallel`);
    },
    invalidate() {
      const picked = read();
      if (scene.current === null || picked === null) return;
      invalidateMotion(scene.current.internal.motionManager, picked.group, picked.index);
      log(`invalidateMotion(${picked.group},${picked.index}) — next play reloads the file`);
    },
  };
}

function describe(req: LayeredMotionRequest): string {
  const channel = req.channel === "primary" ? "primary" : `parallel[${req.channel}]`;
  return `(${req.group}, ${req.index}, p${req.priority}, loop=${req.loop ?? false}) on ${channel}, ignore=${req.ignoreParamIds.length}`;
}
