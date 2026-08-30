import { describe, expect, it } from "vitest";
import { enterSubmits, escapeCloses } from "./chat-bubble.tsx";

describe("pet bubble Enter-to-submit gate (A2 IME safety)", () => {
  it("submits on plain Enter outside an IME composition", () => {
    expect(enterSubmits("Enter", false)).toBe(true);
  });

  it("never submits while a composition is active (candidate confirmation)", () => {
    expect(enterSubmits("Enter", true)).toBe(false);
  });

  it("leaves every other key alone (Escape close is not part of this gate)", () => {
    expect(enterSubmits("Escape", false)).toBe(false);
    expect(enterSubmits("Escape", true)).toBe(false);
  });
});

describe("pet bubble Escape-to-close gate (A2 IME safety)", () => {
  it("closes on Escape outside an IME composition", () => {
    expect(escapeCloses("Escape", false)).toBe(true);
  });

  it("does not close while a composition is active (the IME may consume Escape)", () => {
    expect(escapeCloses("Escape", true)).toBe(false);
  });

  it("leaves every other key alone", () => {
    expect(escapeCloses("Enter", false)).toBe(false);
    expect(escapeCloses("a", false)).toBe(false);
  });
});
