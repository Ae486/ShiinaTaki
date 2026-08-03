/**
 * INPUT:  the wheel item registry with openHome mocked (no Tauri runtime) and a spy costume opener.
 * OUTPUT: assertions that the rows are unique + ordered and that each row's run() reaches its target — chat/home
 *         navigate the home window, costume opens the pet-side costume panel.
 * POS:    unit test for features/operation-wheel/wheel-items. Exempt from size caps.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const navigated = vi.hoisted(() => ({ pages: [] as string[], fails: false }));

vi.mock("@/lib/open-home-window.js", () => ({
  openHome: (page: string) => {
    navigated.pages.push(page);
    return navigated.fails ? Promise.reject(new Error("boom")) : Promise.resolve();
  },
}));

const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@/components/toast/toast-store.js", () => ({
  pushToast: (message: string) => toasts.push(message),
}));

const { WHEEL_ITEMS } = await import("./wheel-items.ts");
const { DEFAULT_PAGE_ID } = await import("@/windows/home/pages.js");

function row(id: string) {
  const item = WHEEL_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`missing wheel row: ${id}`);
  return item;
}

beforeEach(() => {
  navigated.pages = [];
  navigated.fails = false;
  toasts.length = 0;
});

describe("WHEEL_ITEMS", () => {
  it("registers unique ids in a stable order, each with a label", () => {
    expect(WHEEL_ITEMS.map((item) => item.id)).toEqual(["chat", "home", "costume"]);
    expect(new Set(WHEEL_ITEMS.map((item) => item.id)).size).toBe(WHEEL_ITEMS.length);
    for (const item of WHEEL_ITEMS) expect(item.label.length).toBeGreaterThan(0);
  });

  it("navigates the home window from the chat and home rows", () => {
    const openCostume = vi.fn();
    row("chat").run({ openCostume });
    row("home").run({ openCostume });
    expect(navigated.pages).toEqual(["chat", DEFAULT_PAGE_ID]);
    expect(openCostume).not.toHaveBeenCalled();
  });

  it("opens the pet-side costume panel from the costume row", () => {
    const openCostume = vi.fn();
    row("costume").run({ openCostume });
    expect(openCostume).toHaveBeenCalledTimes(1);
    expect(navigated.pages).toEqual([]);
  });

  it("toasts instead of throwing when the home window fails to open", async () => {
    navigated.fails = true;
    row("chat").run({ openCostume: vi.fn() });
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0]).toContain("boom");
  });
});
