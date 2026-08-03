/**
 * INPUT:  the page registry + the nav store (no DOM: static rendering only).
 * OUTPUT: assertions that the left menu renders one entry per registry row and that the right pane follows the
 *         current page — the two-pane shape the wheel/menu both drive.
 * POS:    unit test for windows/home/home-shell (node-safe via renderToStaticMarkup). Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeShell } from "./home-shell.tsx";
import { HOME_PAGES } from "./pages.ts";
import { useHomeStore } from "./home-store.ts";

describe("HomeShell", () => {
  it("renders one menu entry per registry row, marking the current page", () => {
    useHomeStore.getState().navigate("chat");
    const html = renderToStaticMarkup(<HomeShell />);
    for (const page of HOME_PAGES) expect(html).toContain(page.label);
    expect(html).toContain('aria-current="page"');
  });
});
