import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExtensionConvergenceStrip } from "./extension-convergence.tsx";

const HOST = "11111111-1111-4111-8111-111111111111";

describe("ExtensionConvergenceStrip", () => {
  it("renders compact owner, Host, extension, and collision facts", () => {
    const html = renderToStaticMarkup(<ExtensionConvergenceStrip state={{
      kind: "ready",
      data: {
        observedAt: "2026-08-18T00:00:00.000Z",
        coreHostId: HOST,
        hosts: [{ hostId: HOST, available: true, connectionGeneration: 1, catalogGeneration: 2, extensionCount: 3 }],
        entries: [],
        collisions: [],
      },
    }} />);
    expect(html).toContain("11111111…1111"); // short form displays
    expect(html).toContain('aria-label="复制 Core"'); // copy affordance rides the id
    expect(html).toContain("Hosts 1/1");
    expect(html).toContain("Extensions 0");
    expect(html).toContain("Collisions 0");
  });
});
