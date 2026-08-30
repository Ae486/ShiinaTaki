import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionStatusBanner, PetConnectionStatusNotice } from "./connection-status.tsx";

describe("connection status presentation", () => {
  it("hides both surfaces when connected", () => {
    expect(renderToStaticMarkup(<ConnectionStatusBanner status={{ kind: "connected" }} />)).toBe("");
    expect(renderToStaticMarkup(<PetConnectionStatusNotice status={{ kind: "connected" }} />)).toBe("");
  });

  it("keeps the Pet notice compact, pointer-transparent, and free of the interactive hit-test marker", () => {
    const html = renderToStaticMarkup(<PetConnectionStatusNotice status={{ kind: "reconnecting" }} />);
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("正在重连");
    expect(html).not.toContain("data-keep-interactive");
    expect(html).not.toContain("h-full");
  });

  it("uses a persistent status role on the Home/Chat banner", () => {
    const html = renderToStaticMarkup(<ConnectionStatusBanner status={{ kind: "pairing-required" }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("需要完成配对");
  });

  it("renders the Home/Chat banner as a non-shifting overlay strip (U6)", () => {
    const html = renderToStaticMarkup(<ConnectionStatusBanner status={{ kind: "reconnecting" }} />);
    expect(html).toContain("absolute");
    expect(html).toContain("z-(--z-notice)");
    expect(html).toContain("shadow-overlay");
  });
});
