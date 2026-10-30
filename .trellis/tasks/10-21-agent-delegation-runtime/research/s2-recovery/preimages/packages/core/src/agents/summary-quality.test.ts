import { describe, expect, it } from "vitest";
import { validateSummary } from "./summary-quality.ts";

describe("summary quality", () => {
  const sourceText = "A promise remains open and the user expects a follow-up.";

  it("rejects blank and provider-truncated output", () => {
    expect(validateSummary({ text: "  ", sourceText }).code).toBe("blank");
    expect(validateSummary({ text: "partial", sourceText, finishReason: "length" }).code).toBe("truncated");
    expect(validateSummary({ text: "filtered", sourceText, finishReason: "content-filter" }).code).toBe("truncated");
    expect(validateSummary({ text: "failed", sourceText, finishReason: "error" }).code).toBe("truncated");
  });

  it("rejects non-shrinking and forbidden content", () => {
    expect(validateSummary({ text: sourceText, sourceText }).code).toBe("non_shrinking");
    expect(validateSummary({ text: "api_key=secret", sourceText, strictShrink: false }).code).toBe("forbidden_content");
    expect(validateSummary({ text: "identity-card", sourceText, protectedContent: ["identity-card"], strictShrink: false }).code).toBe("protected_content");
    expect(validateSummary({ text: "Authorization: Bearer abc123", sourceText, strictShrink: false }).code).toBe("forbidden_content");
    expect(validateSummary({ text: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----", sourceText, strictShrink: false }).code).toBe("forbidden_content");
  });

  it("accepts a concise factual projection", () => {
    expect(validateSummary({ text: "On 2026-08-31, a follow-up remained open.", sourceText }).accepted).toBe(true);
  });
});
