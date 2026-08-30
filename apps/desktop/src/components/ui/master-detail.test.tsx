/**
 * INPUT:  <MasterDetail> static markup (both slots rendered, panes classed, breakpoint variants).
 * OUTPUT: assertions that the two-pane shell renders the list aside + detail column and carries the container-query
 *         classes for the requested breakpoint (stacking under the breakpoint is pure CSS — class presence is the contract).
 * POS:    unit test for components/ui/master-detail (node-safe via renderToStaticMarkup). Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MasterDetail } from "./master-detail.tsx";

describe("MasterDetail", () => {
  it("renders the list aside and the detail column", () => {
    const html = renderToStaticMarkup(<MasterDetail list={<p>列表</p>} detail={<p>详情</p>} />);
    expect(html).toContain("<aside");
    expect(html).toContain("列表");
    expect(html).toContain("详情");
  });

  it("carries the @xl container-query classes by default", () => {
    const html = renderToStaticMarkup(<MasterDetail list={<p>l</p>} detail={<p>d</p>} />);
    expect(html).toContain("@container");
    expect(html).toContain("@xl:flex-row");
    expect(html).toContain("@xl:w-60");
  });

  it("switches the pane classes for an explicit breakpoint", () => {
    const html = renderToStaticMarkup(<MasterDetail list={<p>l</p>} detail={<p>d</p>} breakpoint="@3xl" />);
    expect(html).toContain("@3xl:flex-row");
    expect(html).toContain("@3xl:w-60");
    expect(html).not.toContain("@xl:flex-row");
  });
});
