/**
 * INPUT:  the loaded PetScene (isOpaqueAt alpha test + focusAt gaze) + the shared dragging/bubbleOpen flags; Tauri's
 *         global cursorPosition, the pet window geometry (innerPosition/scaleFactor), and setIgnoreCursorEvents.
 * OUTPUT: drives per-pixel click-through AND gaze follow from ONE global-cursor poll — maps the cursor to canvas-local
 *         px, toggles ignore-cursor-events (only on change), and points the model's gaze at the cursor each tick.
 * POS:    ui/windows/pet — hook owns the Tauri window access (approach B, no Rust). Reads the shared flags so a drag
 *         or an open bubble never drops through; exposes error state (async Tauri calls) per hook guidelines.
 */

import { useEffect, useRef, useState } from "react";
import { cursorPosition, getCurrentWindow, type Window as TauriWindow } from "@tauri-apps/api/window";
import type { PetScene } from "@/renderer/pet-scene.js";
import { useInteractionStore } from "@/stores/interaction-store.js";
import { shouldIgnoreCursor } from "./click-through-toggle.ts";

// ~40Hz: responsive enough that the toggle feels instant, far below the rate that would peg a core (IPC per tick).
const POLL_INTERVAL_MS = 24;

type PollContext = {
  win: TauriWindow;
  scene: PetScene;
  isDragging: () => boolean;
  isBubbleOpen: () => boolean;
  scaleFactor: number;
  buttonDown: boolean;
  lastIgnore: boolean | null;
  busy: boolean;
  onError: (message: string | null) => void;
};

async function pollOnce(ctx: PollContext): Promise<void> {
  if (ctx.busy) return; // never overlap: an interval tick that arrives mid-IPC is skipped, not queued.
  ctx.busy = true;
  try {
    const [cursor, origin] = await Promise.all([cursorPosition(), ctx.win.innerPosition()]);
    const x = (cursor.x - origin.x) / ctx.scaleFactor;
    const y = (cursor.y - origin.y) / ctx.scaleFactor;
    // Gaze follow (F4) rides this same cursor read — no second poll, so it adds zero IPC to the always-on overlay.
    ctx.scene.focusAt(x, y);
    const opaque = ctx.scene.isOpaqueAt(x, y);
    const ignore = shouldIgnoreCursor({
      dragging: ctx.isDragging(),
      buttonDown: ctx.buttonDown,
      bubbleOpen: ctx.isBubbleOpen(),
      opaque,
    });
    if (ignore !== ctx.lastIgnore) {
      await ctx.win.setIgnoreCursorEvents(ignore);
      ctx.lastIgnore = ignore;
    }
    ctx.onError(null);
  } catch (error) {
    ctx.onError(error instanceof Error ? error.message : String(error));
  } finally {
    ctx.busy = false;
  }
}

export function useClickThrough(scene: PetScene | null): { error: string | null } {
  const [error, setError] = useState<string | null>(null);
  const dragging = useInteractionStore((s) => s.dragging);
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;
  const bubbleOpen = useInteractionStore((s) => s.bubbleOpen);
  const bubbleOpenRef = useRef(bubbleOpen);
  bubbleOpenRef.current = bubbleOpen;

  useEffect(() => {
    if (!scene) return;
    const ctx: PollContext = {
      win: getCurrentWindow(),
      scene,
      isDragging: () => draggingRef.current,
      isBubbleOpen: () => bubbleOpenRef.current,
      scaleFactor: 1,
      buttonDown: false,
      lastIgnore: null,
      busy: false,
      onError: (message) => setError((prev) => (prev === message ? prev : message)),
    };
    void ctx.win.scaleFactor().then((factor) => (ctx.scaleFactor = factor)).catch(() => undefined);

    const onDown = (event: PointerEvent) => { if (event.button === 0) ctx.buttonDown = true; };
    const onUp = () => { ctx.buttonDown = false; };
    // buttons===0 recovers a release the OS swallowed during a window drag (pointerup may never reach the webview).
    const onMove = (event: PointerEvent) => { if (event.buttons === 0) ctx.buttonDown = false; };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("blur", onUp);

    const timer = window.setInterval(() => void pollOnce(ctx), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", onUp);
      // Restore interactivity on teardown so a disposed overlay never leaves the window stuck click-through.
      void ctx.win.setIgnoreCursorEvents(false).catch(() => undefined);
    };
  }, [scene]);

  return { error };
}
