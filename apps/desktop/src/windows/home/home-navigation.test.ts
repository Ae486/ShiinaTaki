/**
 * INPUT:  the page registry + the boot query param + the nav store.
 * OUTPUT: assertions that the registry is the single source of the menu (unique ordered ids), that only registered
 *         ids pass the runtime gate, that `?page=` boots the right page, and that navigate() switches it.
 * POS:    unit test for windows/home navigation (node-safe: no DOM). Exempt from size caps.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PAGE_ID, HOME_PAGES, isPageId, visibleHomePages } from "./pages.ts";
import { pageFromSearch } from "./boot-page.ts";
import { useHomeStore } from "./home-store.ts";
import { appendVisitedPage } from "./visited-page-ids.ts";

describe("home page registry", () => {
  it("registers the home pages in menu order, chat first", () => {
    expect(HOME_PAGES.map((page) => page.id)).toEqual(["chat", "subagents", "initiative", "qqmm", "settings", "operations", "perception", "costume", "mcp", "skills", "monitor"]);
    expect(DEFAULT_PAGE_ID).toBe("chat");
  });

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

  it("removes the monitor entry entirely while monitoring is disabled", () => {
    expect(visibleHomePages(false).some((page) => page.id === "monitor")).toBe(false);
    expect(visibleHomePages(true).some((page) => page.id === "monitor")).toBe(true);
  });
});

describe("pageFromSearch", () => {
  it("boots the requested registered page", () => {
    expect(pageFromSearch("?page=chat")).toBe("chat");
    expect(pageFromSearch("?page=qqmm")).toBe("qqmm");
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

describe("visited page ids", () => {
  it("appends a page once and preserves visit order", () => {
    expect(appendVisitedPage(["chat"], "mcp")).toEqual(["chat", "mcp"]);
    expect(appendVisitedPage(["chat", "mcp"], "chat")).toEqual(["chat", "mcp"]);
  });
});
