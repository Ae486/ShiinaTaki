/**
 * INPUT:  the wheel item registry with openHome mocked (no Tauri runtime).
 * OUTPUT: assertions that the four rows are unique + ordered and that every row's run() navigates the home window to
 *         its page — since batch 4 the wheel holds shortcuts only, with no pet-side overlay left.
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
  it("registers exactly the owner's four shortcuts, unique and in order", () => {
    expect(WHEEL_ITEMS.map((item) => item.id)).toEqual(["chat", "settings", "costume", "home"]);
    expect(new Set(WHEEL_ITEMS.map((item) => item.id)).size).toBe(WHEEL_ITEMS.length);
    for (const item of WHEEL_ITEMS) expect(item.label.length).toBeGreaterThan(0);
  });

  it("navigates the home window from every row, including the migrated costume row", () => {
    for (const item of WHEEL_ITEMS) item.run();

    expect(navigated.pages).toEqual(["chat", "settings", "costume", DEFAULT_PAGE_ID]);
  });

  it("toasts instead of throwing when the home window fails to open", async () => {
    navigated.fails = true;
    row("chat").run();
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0]).toContain("boom");
  });
});
