import { describe, expect, it, vi } from "vitest";
import { observeOwnWindow } from "./own-window-visibility.ts";

const document = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => false }) as Document;
const window = new EventTarget() as Window;

describe("own-window lifecycle", () => {
  it("invalidates an in-flight native query on retirement and releases late listener registration", async () => {
    let resolve!: (value: boolean) => void;
    let register!: (unlisten: () => void) => void;
    const changed = vi.fn(); const unlisten = vi.fn();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    const owner = observeOwnWindow({ changed, document, window, native: {
      isVisible: () => new Promise((done) => { resolve = done; }), isMinimized: async () => false, isFocused: async () => true,
      onFocusChanged: () => new Promise((done) => { register = done; }), onResized: async () => unlisten, onCloseRequested: async () => unlisten,
    } });
    expect(changed).toHaveBeenLastCalledWith({ visible: false, focused: false });
    changed.mockClear(); owner.dispose(); resolve(true); register(unlisten);
    await Promise.resolve(); await Promise.resolve();
    expect(changed).not.toHaveBeenCalled(); expect(unlisten).toHaveBeenCalledTimes(3);
  });
  it("withdraws the previous interval during a routine renewal query, even before a hide event", async () => {
    let resolve!: (value: boolean) => void;
    let pending = false;
    const changed = vi.fn();
    const owner = observeOwnWindow({ changed, document, window, native: {
      isVisible: () => pending ? new Promise((done) => { resolve = done; }) : Promise.resolve(true),
      isMinimized: async () => false, isFocused: async () => false,
      onFocusChanged: async () => () => undefined, onResized: async () => () => undefined, onCloseRequested: async () => () => undefined,
    } });
    await owner.refresh(); expect(changed).toHaveBeenLastCalledWith({ visible: true, focused: false });
    pending = true; const refresh = owner.refresh();
    expect(changed).toHaveBeenLastCalledWith({ visible: false, focused: false });
    resolve(false); await refresh;
    expect(changed).toHaveBeenLastCalledWith({ visible: false, focused: false }); owner.dispose();
  });
  it("withdraws visibility before awaiting a new native result and stays unknown on query failure", async () => {
    let changedNative!: () => void;
    let visible = true;
    const changed = vi.fn();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    const owner = observeOwnWindow({ changed, document, window, native: {
      isVisible: async () => { if (!visible) throw new Error("native unavailable"); return true; },
      isMinimized: async () => false, isFocused: async () => false,
      onFocusChanged: async (callback) => { changedNative = callback; return () => undefined; },
      onResized: async () => () => undefined, onCloseRequested: async () => () => undefined,
    } });
    await owner.refresh(); expect(changed).toHaveBeenLastCalledWith({ visible: true, focused: false });
    visible = false; changedNative(); expect(changed).toHaveBeenLastCalledWith({ visible: false, focused: false });
    await Promise.resolve(); await Promise.resolve(); expect(changed).toHaveBeenLastCalledWith({ visible: false, focused: false });
    owner.dispose();
  });
});
