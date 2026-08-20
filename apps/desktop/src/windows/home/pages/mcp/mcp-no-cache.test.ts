import { describe, expect, it } from "vitest";
import { canPersist } from "@/lib/cache-persist.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("MCP lifecycle cache boundary", () => {
  it("has no persisted page-cache key for MCP desired or runtime state", () => {
    // Permission-snapshot discipline applies: MCP state is a disposable Core view, refetched per client
    // generation — it never enters useCachedFetch persistence, localStorage, or Zustand persistence.
    for (const key of ["mcp", "mcp-servers", "mcp-status", "mcp-desired"]) {
      expect(canPersist(key)).toBe(false);
    }
  });

  it("keeps secret values out of every MCP page seam (write-only inputs, no value echo)", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    for (const relative of [
      "windows/home/pages/mcp/mcp-state.ts",
      "windows/home/pages/mcp/mcp-controller.ts",
      "windows/home/pages/mcp/mcp-page.tsx",
      "windows/home/pages/mcp/mcp-server-editor.tsx",
    ]) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source).not.toMatch(/localStorage/);
      expect(source).not.toMatch(/useCachedFetch/);
    }
  });
});
