/**
 * INPUT:  a mocked @tauri-apps/api surface (WebviewWindow + emitTo) — no real Tauri runtime.
 * OUTPUT: assertions on the pet→home seam: absent window → created ONCE at the requested page, present window →
 *         restore + navigate + focus (never a second window), and a create failure rejecting to the caller.
 * POS:    unit test for lib/open-home-window (node-safe). Exempt from size caps.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => {
  const state = {
    existing: null as { unminimize: () => Promise<void>; show: () => Promise<void>; setFocus: () => Promise<void> } | null,
    created: [] as Array<{ label: string; url: string }>,
    emitted: [] as Array<{ target: string; event: string; payload: unknown }>,
    shown: 0,
    unminimized: 0,
    focused: 0,
    createFails: false,
  };
  return state;
});

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: (target: string, event: string, payload: unknown) => {
    tauri.emitted.push({ target, event, payload });
    return Promise.resolve();
  },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel() {
      return Promise.resolve(tauri.existing);
    }
    constructor(label: string, options: { url: string }) {
      tauri.created.push({ label, url: options.url });
    }
    once(event: string, handler: (payload: { payload: unknown }) => void) {
      const wanted = tauri.createFails ? "tauri://error" : "tauri://created";
      if (event === wanted) handler({ payload: "boom" });
      return Promise.resolve(() => undefined);
    }
  },
}));

const { openHome, HOME_NAVIGATE_EVENT } = await import("./open-home-window.ts");

beforeEach(() => {
  tauri.existing = null;
  tauri.created = [];
  tauri.emitted = [];
  tauri.shown = 0;
  tauri.unminimized = 0;
  tauri.focused = 0;
  tauri.createFails = false;
});

function existingWindow() {
  return {
    unminimize: () => {
      tauri.unminimized += 1;
      return Promise.resolve();
    },
    show: () => {
      tauri.shown += 1;
      return Promise.resolve();
    },
    setFocus: () => {
      tauri.focused += 1;
      return Promise.resolve();
    },
  };
}

describe("openHome", () => {
  it("creates the home window at the requested page when none is open", async () => {
    await openHome("chat");
    expect(tauri.created).toEqual([{ label: "home", url: "home.html?page=chat" }]);
    expect(tauri.emitted).toEqual([]);
  });

  it("navigates + focuses the open window instead of creating a second one (single instance)", async () => {
    tauri.existing = existingWindow();
    await openHome("chat");
    await openHome("chat");
    expect(tauri.created).toEqual([]);
    expect(tauri.emitted).toEqual([
      { target: "home", event: HOME_NAVIGATE_EVENT, payload: { page: "chat" } },
      { target: "home", event: HOME_NAVIGATE_EVENT, payload: { page: "chat" } },
    ]);
    expect(tauri.shown).toBe(2);
    expect(tauri.unminimized).toBe(2);
    expect(tauri.focused).toBe(2);
  });

  it("rejects when the window fails to be created (packaged builds have no devtools)", async () => {
    tauri.createFails = true;
    await expect(openHome("chat")).rejects.toThrow();
  });
});
