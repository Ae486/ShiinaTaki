/**
 * INPUT:  the page registry + the boot query param + the nav store.
 * OUTPUT: assertions that the registry is the single source of the menu (unique ordered ids), that only registered
 *         ids pass the runtime gate, that `?page=` boots the right page, and that navigate() switches it.
 * POS:    unit test for windows/home navigation (node-safe: no DOM). Exempt from size caps.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PAGE_ID, HOME_PAGES, isPageId } from "./pages.ts";
import { pageFromSearch } from "./boot-page.ts";
import { useHomeStore } from "./home-store.ts";

describe("home page registry", () => {
  it("exposes ordered rows with unique ids, labels and components", () => {
    const ids = HOME_PAGES.map((page) => page.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const page of HOME_PAGES) {
      expect(page.label.length).toBeGreaterThan(0);
      expect(typeof page.component).toBe("function");
    }
  });

  it("registers the default page", () => {
    expect(isPageId(DEFAULT_PAGE_ID)).toBe(true);
  });

  it("gates unregistered ids at runtime", () => {
    expect(isPageId("chat")).toBe(true);
    expect(isPageId("nope")).toBe(false);
    expect(isPageId(undefined)).toBe(false);
  });
});

describe("pageFromSearch", () => {
  it("boots the requested registered page", () => {
    expect(pageFromSearch("?page=chat")).toBe("chat");
  });

  it("falls back to the default for a missing or unregistered page", () => {
    expect(pageFromSearch("")).toBe(DEFAULT_PAGE_ID);
    expect(pageFromSearch("?page=nope")).toBe(DEFAULT_PAGE_ID);
  });
});

describe("home store", () => {
  beforeEach(() => useHomeStore.getState().navigate(DEFAULT_PAGE_ID));

  it("starts on the default page and switches on navigate", () => {
    expect(useHomeStore.getState().currentPage).toBe(DEFAULT_PAGE_ID);
    useHomeStore.getState().navigate("chat");
    expect(useHomeStore.getState().currentPage).toBe("chat");
  });
});
