/**
 * INPUT:  SelectionTile instances rendered to static markup (no DOM: static rendering only).
 * OUTPUT: assertions for the state attribute contract (aria-pressed vs aria-current), the unified accent
 *         recipe on selected/idle tiles, and the disabled passthrough.
 * POS:    unit test for components/ui/selection-tile. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectionTile } from "./selection-tile.tsx";

describe("SelectionTile", () => {
  it("marks a selected aria-pressed tile with the unified accent recipe", () => {
    const html = renderToStaticMarkup(
      <SelectionTile selected onSelect={() => undefined}>运行 A</SelectionTile>,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("bg-accent-soft");
    expect(html).toContain("text-accent-text");
    expect(html).toContain("ring-accent-border");
  });

  it("renders idle tiles as unpressed (aria-pressed=false) with the idle recipe", () => {
    const html = renderToStaticMarkup(
      <SelectionTile selected={false} onSelect={() => undefined}>运行 B</SelectionTile>,
    );
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("text-text-body");
    expect(html).toContain("hover:bg-surface-muted");
  });

  it("uses aria-current for the current-row variant and omits it when idle", () => {
    const current = renderToStaticMarkup(
      <SelectionTile selected stateAttr="aria-current" onSelect={() => undefined}>当前</SelectionTile>,
    );
    expect(current).toContain('aria-current="true"');
    const idle = renderToStaticMarkup(
      <SelectionTile selected={false} stateAttr="aria-current" onSelect={() => undefined}>其余</SelectionTile>,
    );
    expect(idle).not.toContain("aria-current");
  });

  it("disables the tile and keeps the border emphasis recipe layout-stable", () => {
    const html = renderToStaticMarkup(
      <SelectionTile selected={false} emphasis="border" disabled onSelect={() => undefined}>锁定</SelectionTile>,
    );
    expect(html).toContain("disabled");
    expect(html).toContain("border-border");
  });
});
