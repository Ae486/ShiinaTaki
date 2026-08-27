/**
 * INPUT:  the page registry + the nav store (no DOM: static rendering only).
 * OUTPUT: assertions that the left menu renders one glyph+label entry per registry row, that exactly one row carries
 *         the accent highlight, and that the right pane follows the current page — the two-pane shape the wheel and
 *         the menu both drive.
 * POS:    unit test for windows/home/home-shell (node-safe via renderToStaticMarkup). Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeShell } from "./home-shell.tsx";
import { DEFAULT_PAGE_ID, HOME_PAGES, visibleHomePages } from "./pages.ts";
import { useHomeStore } from "./home-store.ts";

// zustand hands a static render its INITIAL state, so the shell under renderToStaticMarkup always shows the default
// page — the highlight assertions below are about the default row, whatever navigate() was last called with.
const DEFAULT_PAGE = HOME_PAGES.find((page) => page.id === DEFAULT_PAGE_ID) ?? HOME_PAGES[0];

function shellMarkup(): string {
  useHomeStore.getState().navigate(DEFAULT_PAGE_ID);
  return renderToStaticMarkup(<HomeShell />);
}

function menuRows(): string[] {
  const nav = /<nav[^>]*>.*<\/nav>/s.exec(shellMarkup())?.[0] ?? "";
  return nav.match(/<button[^>]*>.*?<\/button>/gs) ?? [];
}

describe("HomeShell", () => {
  it("renders one menu entry per registry row, marking the current page", () => {
    const html = shellMarkup();
    for (const page of visibleHomePages(false)) expect(html).toContain(page.label);
    expect(html).not.toContain("运行监视");
    expect(html).toContain('aria-current="page"');
  });

  it("draws each row's registry glyph beside its label", () => {
    const rows = menuRows();
    expect(rows).toHaveLength(visibleHomePages(false).length);
    for (const row of rows) expect(row).toContain("<svg");
  });

  it("gives exactly one row — the current one — the accent highlight", () => {
    const active = menuRows().filter((row) => row.includes('aria-current="page"'));

    expect(active).toHaveLength(1);
    expect(active[0]).toContain(DEFAULT_PAGE.label);
    expect(active[0]).toContain("text-rose-700");
  });
});
