import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

// The Privacy Pause is the user's withdrawal of consent to be observed. It must be unreachable from anything the
// agent can drive — no tool, no capability, no memory hook — exactly as the Permission Level is (spec
// permission-authorization §NL red line 2/3). That is a property of the whole source tree, not of one module, so it
// is pinned by a sweep: flip any production file to call a mutator and this test goes red.
const CORE_SRC = fileURLToPath(new URL("..", import.meta.url));
const MUTATORS = /\.(pauseUntilResumed|pauseUntil|resume)\(/;
const ONLY_WRITER = join("server", "methods", "perception-pause-set.ts");

function productionFiles(): string[] {
  return readdirSync(CORE_SRC, { recursive: true }).filter(
    (entry): entry is string =>
      typeof entry === "string" &&
      entry.endsWith(".ts") &&
      !entry.endsWith(".test.ts") &&
      // core/testing/* ships only test doubles; it is never imported by production code (its own header says so).
      !entry.startsWith(`testing${sep}`),
  );
}

describe("privacy pause has exactly one production writer", () => {
  it("finds pause mutations only in the operator-only perception.pauseSet method", () => {
    const writers = productionFiles().filter((file) => MUTATORS.test(readFileSync(join(CORE_SRC, file), "utf8")));
    expect(writers).toEqual([ONLY_WRITER]);
  });

  it("sweeps a non-trivial slice of the core tree (a broken sweep must not pass vacuously)", () => {
    expect(productionFiles().length).toBeGreaterThan(50);
  });
});
