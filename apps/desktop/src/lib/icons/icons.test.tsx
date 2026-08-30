/**
 * INPUT:  every glyph rendered to static markup (no DOM: static rendering only).
 * OUTPUT: assertions that each icon draws a 24x24 stroke svg with artwork inside and passes the caller's className
 *         through — the contract the page/wheel registries rely on when they size and colour an icon slot.
 * POS:    unit test for lib/icons. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { IconComponent } from "./glyph.tsx";
import { ChatIcon } from "./chat-icon.tsx";
import { SettingsIcon } from "./settings-icon.tsx";
import { CostumeIcon } from "./costume-icon.tsx";
import { HomeIcon } from "./home-icon.tsx";
import { OperationsIcon } from "./operations-icon.tsx";
import { PerceptionIcon } from "./perception-icon.tsx";
import { ToolIcon } from "./tool-icon.tsx";

const ICONS: Array<[string, IconComponent]> = [
  ["chat", ChatIcon],
  ["settings", SettingsIcon],
  ["costume", CostumeIcon],
  ["home", HomeIcon],
  ["operations", OperationsIcon],
  ["perception", PerceptionIcon],
  ["tool", ToolIcon],
];

describe.each(ICONS)("%s icon", (_name, Icon) => {
  it("renders a 24x24 stroke svg carrying artwork", () => {
    const html = renderToStaticMarkup(<Icon />);
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toMatch(/<(path|circle)/);
  });

  it("passes the caller's className through", () => {
    expect(renderToStaticMarkup(<Icon className="h-5 w-5 text-rose-600" />)).toContain('class="h-5 w-5 text-rose-600"');
  });
});
