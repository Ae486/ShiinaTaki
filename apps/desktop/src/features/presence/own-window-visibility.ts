/**
 * INPUT: current Tauri window queries and native/document lifecycle events
 * OUTPUT: fail-closed self-window visibility with fenced asynchronous refreshes
 * POS: ui/presence — existing own-window metadata only; no ambient acquisition or occlusion claim
 */
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface OwnWindowState { visible: boolean; focused: boolean }
interface WindowQueries {
  isVisible(): Promise<boolean>;
  isMinimized(): Promise<boolean>;
  isFocused(): Promise<boolean>;
  onFocusChanged(callback: () => void): Promise<() => void>;
  onResized(callback: () => void): Promise<() => void>;
  onCloseRequested(callback: () => void): Promise<() => void>;
}
interface VisibilityInput {
  changed(state: OwnWindowState): void;
  /** Routine queries suspend exposure only; event-driven unknown state still ends input continuity. */
  checking?(): void;
  document: Document;
  window: Window;
  native?: WindowQueries;
}
const UNKNOWN: OwnWindowState = { visible: false, focused: false };

export function observeOwnWindow(input: VisibilityInput) {
  let disposed = false;
  let unavailable = false;
  let epoch = 0;
  const cleanups: Array<() => void> = [];
  const native = input.native ?? getCurrentWindow();
  const invalidate = (preserveInput = false) => {
    epoch += 1;
    if (preserveInput && input.checking) input.checking(); else input.changed(UNKNOWN);
  };
  const refresh = async (preserveInput = true) => {
    if (disposed) return;
    // Every query ends display evidence. Routine checks can retain independently live input listeners.
    invalidate(preserveInput);
    const ticket = epoch;
    if (unavailable || input.document.hidden) { input.changed(UNKNOWN); return; }
    try {
      const [visible, minimized, focused] = await Promise.all([native.isVisible(), native.isMinimized(), native.isFocused()]);
      if (!disposed && ticket === epoch) input.changed({ visible: visible && !minimized && !input.document.hidden,
        focused: focused && input.document.hasFocus() });
    } catch { if (!disposed && ticket === epoch) input.changed(UNKNOWN); }
  };
  const changed = () => { void refresh(false); };
  const retire = () => { if (!disposed) invalidate(); };
  for (const pending of [native.onFocusChanged(changed), native.onResized(changed), native.onCloseRequested(retire)]) {
    void pending.then((unlisten) => { if (disposed) unlisten(); else cleanups.push(unlisten); })
      .catch(() => { unavailable = true; retire(); });
  }
  input.document.addEventListener("visibilitychange", changed);
  input.window.addEventListener("pagehide", retire);
  input.window.addEventListener("focus", changed);
  input.window.addEventListener("blur", changed);
  void refresh(false);
  return { refresh, dispose() {
    disposed = true; epoch += 1;
    cleanups.forEach((cleanup) => cleanup());
    input.document.removeEventListener("visibilitychange", changed);
    input.window.removeEventListener("pagehide", retire);
    input.window.removeEventListener("focus", changed);
    input.window.removeEventListener("blur", changed);
  } };
}
