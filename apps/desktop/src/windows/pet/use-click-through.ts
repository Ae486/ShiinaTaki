/**
 * INPUT:  the loaded PetScene (isOpaqueAt alpha test + focusAt gaze) + the shared dragging flag; Tauri's global
 *         cursorPosition and setIgnoreCursorEvents; the window geometry — scaleFactor fetched once at setup, the
 *         client-area origin (innerPosition) CACHED and refreshed only when it can change (drag end observed by the
 *         poll, Tauri onMoved/onResized dirty-marking, ~2s TTL backstop); the DOM (elementFromPoint) for
 *         element-level UI hit-testing ([data-keep-interactive] bubble/panel) and the hidden flag (visibilitychange).
 * OUTPUT: drives per-pixel click-through, gaze follow, AND the proximity reflex from ONE global-cursor poll
 *         (~31Hz, the interval stopped entirely while the page is hidden) — maps the cursor to canvas-local px,
 *         toggles ignore-cursor-events (only on change), points the model's gaze at the cursor, and feeds the same
 *         coords to the scene's proximity reactor each tick. One IPC per idle tick (was two forever).
 * POS:    ui/windows/pet — hook owns the Tauri window access (approach B, no Rust). An open bubble/panel keeps only
 *         its OWN rect interactive (element-level, B-test 4); exposes error state (async Tauri calls) per hook guidelines.
 */

import { useEffect, useRef, useState } from "react";
import { cursorPosition, getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { PetScene } from "@/renderer/pet-scene.js";
import { useInteractionStore } from "@/stores/interaction-store.js";
import { KEEP_INTERACTIVE_SELECTOR, shouldIgnoreCursor } from "./click-through-toggle.ts";
import { POLL_INTERVAL_MS, mapCursorToCanvas, shouldPollRun, shouldRefreshOrigin } from "./cursor-poll.ts";

// Element-level UI hit test: the bubble/panel mark themselves [data-keep-interactive]; hovering them keeps the
// window interactive while everything around them passes through. Works regardless of the current ignore state —
// elementFromPoint is a render-tree query, not an OS event.
function isOverUi(x: number, y: number): boolean {
  return document.elementFromPoint(x, y)?.closest(KEEP_INTERACTIVE_SELECTOR) != null;
}

type PollContext = {
  win: TauriWindow;
  scene: PetScene;
  isDragging: () => boolean;
  scaleFactor: number;
  buttonDown: boolean;
  lastIgnore: boolean | null;
  busy: boolean;
  // Cached client-area origin (physical px). Fetched lazily on the first tick, then refreshed ONLY when it can have
  // changed: a dragging true→false transition (observed here, serialized with the poll — the post-drag resting
  // position is used the SAME tick, no stale gap), an onMoved/onResized dirty mark, or the TTL backstop. Never
  // per-tick (that second forever-IPC was the P1d waste).
  origin: { x: number; y: number } | null;
  originDirty: boolean;
  originFetchedAt: number;
  prevDragging: boolean;
  onError: (message: string | null) => void;
};

async function pollOnce(ctx: PollContext): Promise<void> {
  if (ctx.busy) return; // never overlap: an interval tick that arrives mid-IPC is skipped, not queued.
  ctx.busy = true;
  try {
    // Track the dragging flag per poll. The true→false transition means the window may have MOVED under the native
    // drag, so the cached origin refreshes in the SAME tick (parallel with the cursor read). Drag start needs no
    // refresh — nothing has moved yet. During the drag itself onMoved marks the cache dirty continuously, so the
    // per-tick origin stays as fresh as it was before the cache existed.
    const dragging = ctx.isDragging();
    const dragEnded = ctx.prevDragging && !dragging;
    ctx.prevDragging = dragging;
    const needsOrigin =
      ctx.origin === null ||
      dragEnded ||
      shouldRefreshOrigin({ dirty: ctx.originDirty, ageMs: performance.now() - ctx.originFetchedAt });
    const [cursor, origin] = await Promise.all([
      cursorPosition(),
      needsOrigin ? ctx.win.innerPosition() : Promise.resolve(null),
    ]);
    if (origin !== null) {
      ctx.origin = { x: origin.x, y: origin.y };
      ctx.originDirty = false;
      ctx.originFetchedAt = performance.now();
    }
    const cachedOrigin = ctx.origin;
    if (cachedOrigin === null) return; // unreachable (needsOrigin true ⇒ fetched above); keeps narrowing honest
    const { x, y } = mapCursorToCanvas(cursor, cachedOrigin, ctx.scaleFactor);
    // Gaze follow (F4) rides this same cursor read — no second poll, so it adds zero IPC to the always-on overlay.
    ctx.scene.focusAt(x, y);
    // Proximity reflex (D17) rides the SAME read too: a cursor entering the near zone triggers a cooldown-gated
    // reaction. Zero new IPC; the reactor throttles internally.
    ctx.scene.handleProximity(x, y);
    const opaque = ctx.scene.isOpaqueAt(x, y);
    const ignore = shouldIgnoreCursor({
      dragging: ctx.isDragging(),
      buttonDown: ctx.buttonDown,
      overUi: isOverUi(x, y),
      opaque,
    });
    if (ignore !== ctx.lastIgnore) {
      await ctx.win.setIgnoreCursorEvents(ignore);
      // Toggle-transition trace (B6 diagnostics): if click-through misbehaves, this shows whether the poll ever
      // computes ignore=true (opaque sampling) vs the call itself failing (which would surface via onError instead).
      console.info(`[click-through] ignore=${String(ignore)} opaque=${String(opaque)} at ${Math.round(x)},${Math.round(y)}`);
      ctx.lastIgnore = ignore;
    }
    ctx.onError(null);
  } catch (error) {
    ctx.onError(error instanceof Error ? error.message : String(error));
  } finally {
    ctx.busy = false;
  }
}

// A press that began on the character must never drop through mid-move: buttonDown suspends the toggle until the
// release is observed. buttons===0 on a move recovers a release the OS swallowed during a window drag (pointerup may
// never reach the webview); blur is the last-resort release. Returns its exact teardown.
function wirePointerReleases(ctx: PollContext): () => void {
  const onDown = (event: PointerEvent) => { if (event.button === 0) ctx.buttonDown = true; };
  const onUp = () => { ctx.buttonDown = false; };
  const onMove = (event: PointerEvent) => { if (event.buttons === 0) ctx.buttonDown = false; };
  window.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("blur", onUp);
  return () => {
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("blur", onUp);
  };
}

// The poll interval + its visibility pause (P1d): the interval is STOPPED entirely while hidden — the render governor
// pauses rendering then, so there is nothing to sample — and restarted with an immediate re-sample on return, so the
// first toggle after unhide is not delayed a tick. Returns its exact teardown.
function startPollInterval(ctx: PollContext): () => void {
  let timer: number | undefined;
  const start = () => {
    timer = window.setInterval(() => void pollOnce(ctx), POLL_INTERVAL_MS);
  };
  const stop = () => {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
  const onVisibility = () => {
    stop();
    if (shouldPollRun(document.hidden)) {
      start();
      void pollOnce(ctx);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  if (shouldPollRun(document.hidden)) start();
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

// The client-area origin changes when the window itself moves/resizes: Tauri window events mark the cache dirty and
// the NEXT poll refreshes it — at most once per tick, so the refresh rate is bounded by the poll (~31Hz), not by the
// event rate. Unlisten promises are tracked for exact teardown (one resolving after cleanup unlistens immediately).
function trackGeometryDirtiness(ctx: PollContext): () => void {
  let disposed = false;
  const unlistens: Array<() => void> = [];
  const track = (promise: Promise<UnlistenFn>) => {
    void promise
      .then((unlisten) => {
        if (disposed) unlisten();
        else unlistens.push(unlisten);
      })
      .catch(() => undefined);
  };
  track(ctx.win.onMoved(() => (ctx.originDirty = true)));
  track(ctx.win.onResized(() => (ctx.originDirty = true)));
  return () => {
    disposed = true;
    for (const unlisten of unlistens) unlisten();
  };
}

export function useClickThrough(scene: PetScene | null): { error: string | null } {
  const [error, setError] = useState<string | null>(null);
  const dragging = useInteractionStore((s) => s.dragging);
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;

  useEffect(() => {
    if (!scene) return;
    const ctx: PollContext = {
      win: getCurrentWindow(),
      scene,
      isDragging: () => draggingRef.current,
      scaleFactor: 1,
      buttonDown: false,
      lastIgnore: null,
      busy: false,
      origin: null,
      originDirty: false,
      originFetchedAt: 0,
      prevDragging: false,
      onError: (message) => setError((prev) => (prev === message ? prev : message)),
    };
    void ctx.win.scaleFactor().then((factor) => (ctx.scaleFactor = factor)).catch(() => undefined);
    // Teardown order: stop the poll first, release the listeners, then restore interactivity LAST so a disposed
    // overlay never leaves the window stuck click-through.
    const teardowns = [startPollInterval(ctx), wirePointerReleases(ctx), trackGeometryDirtiness(ctx)];
    return () => {
      for (const teardown of teardowns) teardown();
      void ctx.win.setIgnoreCursorEvents(false).catch(() => undefined);
    };
  }, [scene]);

  return { error };
}
