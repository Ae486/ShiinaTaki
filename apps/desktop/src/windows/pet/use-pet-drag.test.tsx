/**
 * INPUT:  the drag handlers captured from a static probe render, driven with synthetic left/right pointer events
 *         (Tauri window + interaction store mocked — no DOM, no runtime).
 * OUTPUT: assertions that the LEFT-button path is unchanged (click fires with canvas-local px; past the dead zone it
 *         starts an OS drag and suppresses the click) and that a RIGHT-button sequence produces no click, no drag,
 *         and never raises the shared dragging flag — the owner-reported defect (right-click animated the pet).
 * POS:    unit test for windows/pet/use-pet-drag (node-safe). Exempt from size caps.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PointerEvent as ReactPointerEvent } from "react";

const tauri = vi.hoisted(() => ({ dragStarts: 0 }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: () => {
      tauri.dragStarts += 1;
      return Promise.resolve();
    },
  }),
}));

const store = vi.hoisted(() => ({ dragging: [] as boolean[] }));
vi.mock("@/stores/interaction-store.js", () => ({
  useInteractionStore: (select: (state: { setDragging: (value: boolean) => void }) => unknown) =>
    select({ setDragging: (value: boolean) => store.dragging.push(value) }),
}));

const { usePetDrag } = await import("./use-pet-drag.ts");

const RECT = { currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 20 }) } };

function mountHandlers(onClick: (x: number, y: number) => void) {
  const holder: { handlers?: ReturnType<typeof usePetDrag> } = {};
  function Probe() {
    holder.handlers = usePetDrag(onClick);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (!holder.handlers) throw new Error("probe did not render");
  return holder.handlers;
}

function pointer(button: number, x: number, y: number) {
  // Only the fields the hook reads; cast at this one seam instead of faking a whole PointerEvent.
  return { button, screenX: x, screenY: y, clientX: x, clientY: y, ...RECT } as unknown as ReactPointerEvent<HTMLDivElement>;
}

beforeEach(() => {
  tauri.dragStarts = 0;
  store.dragging = [];
});

describe("usePetDrag", () => {
  it("fires the click with canvas-local px on a left-button press-release", () => {
    const onClick = vi.fn();
    const handlers = mountHandlers(onClick);
    handlers.onPointerDown(pointer(0, 100, 200));
    handlers.onPointerUp(pointer(0, 100, 200));
    expect(onClick).toHaveBeenCalledWith(90, 180);
  });

  it("starts an OS drag past the dead zone and suppresses the click", () => {
    const onClick = vi.fn();
    const handlers = mountHandlers(onClick);
    handlers.onPointerDown(pointer(0, 100, 200));
    handlers.onPointerMove(pointer(0, 140, 200));
    handlers.onPointerUp(pointer(0, 140, 200));
    expect(tauri.dragStarts).toBe(1);
    expect(store.dragging).toContain(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("ignores a right-button sequence entirely (no click reaction, no bubble, no drag)", () => {
    const onClick = vi.fn();
    const handlers = mountHandlers(onClick);
    handlers.onPointerDown(pointer(2, 100, 200));
    handlers.onPointerMove(pointer(2, 160, 260));
    handlers.onPointerUp(pointer(2, 160, 260));
    expect(onClick).not.toHaveBeenCalled();
    expect(tauri.dragStarts).toBe(0);
    expect(store.dragging).not.toContain(true);
  });

  it("ignores a middle-button sequence too (only the primary button acts)", () => {
    const onClick = vi.fn();
    const handlers = mountHandlers(onClick);
    handlers.onPointerDown(pointer(1, 100, 200));
    handlers.onPointerUp(pointer(1, 100, 200));
    expect(onClick).not.toHaveBeenCalled();
  });
});
