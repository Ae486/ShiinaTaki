/**
 * INPUT:  Skeleton instances rendered to static markup (no DOM: static rendering only).
 * OUTPUT: assertions that lines mode renders one pulse bar per line and block mode renders the single
 *         layout stub with the caller's className passthrough.
 * POS:    unit test for components/ui/skeleton. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Skeleton } from "./skeleton.tsx";

describe("Skeleton", () => {
  it("renders one pulse bar per line by default three", () => {
    expect(renderToStaticMarkup(<Skeleton />).match(/animate-pulse/g)).toHaveLength(3);
    expect(renderToStaticMarkup(<Skeleton lines={5} />).match(/animate-pulse/g)).toHaveLength(5);
  });

  it("renders a single block stub carrying the caller's className", () => {
    const html = renderToStaticMarkup(<Skeleton block className="h-10 w-10" />);
    expect(html.match(/animate-pulse/g)).toHaveLength(1);
    expect(html).toContain("h-10 w-10");
  });
});
