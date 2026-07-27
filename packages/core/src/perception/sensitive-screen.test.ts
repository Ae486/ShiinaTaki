import { describe, expect, it } from "vitest";
import { AMBIENT_DESCRIBE_FOCUS, SENSITIVE_SCREEN_TOKEN, isSensitiveScreenVerdict } from "./sensitive-screen.ts";

describe("AMBIENT_DESCRIBE_FOCUS", () => {
  it("names the exact token and the classes the model must refuse to describe", () => {
    expect(AMBIENT_DESCRIBE_FOCUS).toContain(SENSITIVE_SCREEN_TOKEN);
    for (const clazz of ["credentials", "password manager", "banking", "private messages", "login"]) {
      expect(AMBIENT_DESCRIBE_FOCUS).toContain(clazz);
    }
  });
});

describe("isSensitiveScreenVerdict", () => {
  it("accepts the exact token, whatever the surrounding whitespace or case", () => {
    for (const reply of [SENSITIVE_SCREEN_TOKEN, "  sensitive_screen\n", "Sensitive_Screen"]) {
      expect(isSensitiveScreenVerdict(reply)).toBe(true);
    }
  });

  it("is more forgiving than the prompt: wrappers, separators and a hedged sentence still refuse (fail-closed)", () => {
    const sloppy = [
      "**SENSITIVE_SCREEN**",
      "`SENSITIVE_SCREEN`",
      "[SENSITIVE_SCREEN]",
      "SENSITIVE SCREEN",
      "sensitive-screen",
      "SENSITIVE_SCREEN — a bank login form is visible",
      "I cannot describe this: SENSITIVE_SCREEN.",
    ];
    for (const reply of sloppy) expect(isSensitiveScreenVerdict(reply)).toBe(true);
  });

  it("lets an ordinary description through", () => {
    for (const reply of ["VS Code with main.ts open beside a terminal", "A browser showing a news article", ""]) {
      expect(isSensitiveScreenVerdict(reply)).toBe(false);
    }
  });
});
