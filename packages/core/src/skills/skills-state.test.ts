import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createSkillsState } from "./skills-state.ts";

const dirs: string[] = [];
function tmpPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-skills-state-"));
  dirs.push(dir);
  return join(dir, "skills-state.json");
}
function state(filePath: string) {
  const { logger } = createCaptureLogger();
  return createSkillsState({ filePath, logger });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmTempDir(dir);
});

describe("createSkillsState (T20)", () => {
  it("defaults every skill to enabled", () => {
    expect(state(tmpPath()).isDisabled("anything")).toBe(false);
  });

  it("persists disabled skills across instances (round-trip)", () => {
    const path = tmpPath();
    const s = state(path);
    s.disable("noisy");
    expect(s.isDisabled("noisy")).toBe(true);

    const reopened = state(path);
    expect(reopened.isDisabled("noisy")).toBe(true);
    expect(reopened.listDisabled()).toEqual(["noisy"]);
  });

  it("re-enables a skill and persists the removal", () => {
    const path = tmpPath();
    const s = state(path);
    s.disable("noisy");
    s.enable("noisy");
    expect(state(path).isDisabled("noisy")).toBe(false);
  });
});
