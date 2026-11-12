/**
 * INPUT:  a loaded model's internalModel as an EventEmitter (beforeMotionUpdate / afterMotionUpdate /
 *         beforeModelUpdate) + the model's ParamAccess + an optional clock.
 * OUTPUT: createFrameHooks(emitter, params, now?) -> FrameHooks: add(pos, overlay) -> dispose fn, clear(), dispose().
 *         Overlays receive FrameContext { nowMs, dtMs, params }; dt is measured between consecutive beforeMotionUpdate
 *         firings and shared by the two later positions of the same frame.
 * POS:    experimental / lab — not in production path; the ONE seam through which lab overlays touch the engine's
 *         per-frame update (design §3 hook semantics). Structural emitter type -> node-testable with a fake.
 */

import type { ParamAccess } from "./param-access.ts";

export type HookPosition = "beforeMotionUpdate" | "afterMotionUpdate" | "beforeModelUpdate";
export const HOOK_POSITIONS: readonly HookPosition[] = ["beforeMotionUpdate", "afterMotionUpdate", "beforeModelUpdate"];

export interface FrameContext {
  nowMs: number;
  dtMs: number;
  params: ParamAccess;
}

export type Overlay = (ctx: FrameContext) => void;

export interface FrameHooks {
  add(pos: HookPosition, fn: Overlay): () => void;
  clear(): void;
  dispose(): void;
}

export interface FrameEmitter {
  on(event: string, fn: () => void): unknown;
  off(event: string, fn: () => void): unknown;
}

export function createFrameHooks(emitter: FrameEmitter, params: ParamAccess, now: () => number = () => performance.now()): FrameHooks {
  const overlays: Record<HookPosition, Set<Overlay>> = {
    beforeMotionUpdate: new Set(),
    afterMotionUpdate: new Set(),
    beforeModelUpdate: new Set(),
  };
  let frame: FrameContext = { nowMs: 0, dtMs: 0, params };
  let lastBeforeMs: number | null = null;
  let disposed = false;

  const run = (pos: HookPosition): void => {
    for (const fn of overlays[pos]) {
      try {
        fn(frame);
      } catch (err) {
        // A throwing overlay would break the engine's update every frame; eject it and keep the model rendering.
        overlays[pos].delete(fn);
        console.error(`[lab frame-hooks] overlay at ${pos} threw and was removed:`, err);
      }
    }
  };
  const listeners: Record<HookPosition, () => void> = {
    beforeMotionUpdate: () => {
      const nowMs = now();
      frame = { nowMs, dtMs: lastBeforeMs === null ? 0 : nowMs - lastBeforeMs, params };
      lastBeforeMs = nowMs;
      run("beforeMotionUpdate");
    },
    afterMotionUpdate: () => run("afterMotionUpdate"),
    beforeModelUpdate: () => run("beforeModelUpdate"),
  };
  for (const pos of HOOK_POSITIONS) emitter.on(pos, listeners[pos]);

  return {
    add(pos, fn) {
      if (disposed) throw new Error("lab frame-hooks: add() after dispose()");
      overlays[pos].add(fn);
      return () => void overlays[pos].delete(fn);
    },
    clear() {
      for (const pos of HOOK_POSITIONS) overlays[pos].clear();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const pos of HOOK_POSITIONS) {
        emitter.off(pos, listeners[pos]);
        overlays[pos].clear();
      }
    },
  };
}
