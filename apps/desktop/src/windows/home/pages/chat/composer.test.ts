import { describe, expect, it } from "vitest";
import { enterSends } from "./composer.tsx";

describe("composer Enter-to-send gate (A2 IME safety)", () => {
  it("sends on plain Enter outside an IME composition", () => {
    expect(enterSends("Enter", false, false)).toBe(true);
  });

  it("never sends while a composition is active (pinyin candidate confirmation)", () => {
    expect(enterSends("Enter", false, true)).toBe(false);
    expect(enterSends("Enter", true, true)).toBe(false);
  });

  it("keeps Shift+Enter as a newline and ignores every other key", () => {
    expect(enterSends("Enter", true, false)).toBe(false);
    expect(enterSends("a", false, false)).toBe(false);
  });
});
