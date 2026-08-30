/**
 * INPUT:  IconButton instances rendered to static markup (no DOM: static rendering only).
 * OUTPUT: assertions for the accessible-name contract (required aria-label), the 28/32px hit-target sizes,
 *         the tone recipes, and disabled passthrough.
 * POS:    unit test for components/ui/icon-button. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IconButton } from "./icon-button.tsx";

function render(props: Partial<Parameters<typeof IconButton>[0]> = {}): string {
  return renderToStaticMarkup(
    <IconButton label="复制" onClick={() => undefined} {...props}>
      <svg />
    </IconButton>,
  );
}

describe("IconButton", () => {
  it("carries the required accessible name and a 32px hit target by default", () => {
    const html = render();
    expect(html).toContain('aria-label="复制"');
    expect(html).toContain("h-8 w-8");
  });

  it("offers the 28px size for overlay-constrained surfaces and tone recipes", () => {
    expect(render({ size: "sm" })).toContain("h-7 w-7");
    expect(render({ tone: "onDark" })).toContain("text-white/80");
    expect(render({ tone: "solid" })).toContain("bg-surface-strong");
  });

  it("passes disabled through", () => {
    expect(render({ disabled: true })).toContain("disabled");
  });
});
