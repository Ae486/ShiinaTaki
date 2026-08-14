import { describe, expect, it } from "vitest";
import { canPersist } from "@/lib/cache-persist.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("permission and Approval cache boundary", () => {
  it("has no persisted page-cache key for governance or Approval state", () => {
    for (const key of [
      "permission", "permission-level", "permission-cells", "governance-policy",
      "approval", "approval-pending", "approval-session", "approval-decisions",
    ]) {
      expect(canPersist(key)).toBe(false);
    }
  });

  it("keeps pending Approval payloads out of navigation and Tauri event seams", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    for (const relative of [
      "windows/home/pages.ts",
      "lib/costume-switch-event.ts",
      "lib/open-home-window.ts",
    ]) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source).not.toMatch(/approval(?:Id|\.request|\.closed|pending)/i);
    }
  });
});
