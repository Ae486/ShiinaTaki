import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIRECTORY = fileURLToPath(new URL(".", import.meta.url));

describe("Hindsight B3 architecture", () => {
  it("contains no OS/process/Docker execution or Memory Authority mutation imports", () => {
    const source = readdirSync(DIRECTORY).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => readFileSync(join(DIRECTORY, name), "utf8")).join("\n");
    for (const forbidden of ["node:child_process", "docker", "activateCanonicalLocal", "bindCanonical(", "memory_authority_selection SET"]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(source).not.toMatch(/from ["']node:fs["']/);
  });

  it("keeps LLM health reachable only from the explicit setup service action", () => {
    const files = readdirSync(DIRECTORY).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    const callers = files.filter((name) => readFileSync(join(DIRECTORY, name), "utf8").includes(".bankLlmHealth("));
    expect(callers).toEqual(["hindsight-setup-service.ts"]);
  });
});
