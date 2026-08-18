import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("Home Skills authority boundary", () => { it("contains no local persistence or replay queue", () => { for (const file of ["skills-controller.ts", "use-skills.ts", "skills-page.tsx"]) { const source = readFileSync(new URL(file, import.meta.url), "utf8"); expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|persist\s*\(/u); } }); });
