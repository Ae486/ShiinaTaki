import { describe, expect, it } from "vitest";
import { normalizeLegacySource } from "./legacy-source-normalizer.ts";
import { sanitizeLegacyRetainText } from "./legacy-retain-sanitizer.ts";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const entry = (extra = "", body = "remember this"): string =>
  `---\r\nid: legacy id with spaces\r\nlayer: profile\r\nimportance: 9\r\ncreated: 2026-08-20T01:02:03.000+08:00\r\nstatus: active\r\n${extra}---\r\n${body}`;

describe("legacy source normalizer", () => {
  it("accepts pre-origin CRLF entries, arbitrary ids, and unknown flat scalar metadata", () => {
    const raw = bytes(entry("custom_key: unquoted value\r\nreinforce_count: 2\r\n"));
    const result = normalizeLegacySource("entries/global/profile/arbitrary-name.md", raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.origin).toBe("self");
    expect(result.source.legacyId).toBe("legacy id with spaces");
    expect(result.source.reinforceCount).toBe(2);
    expect(result.source.legacyMetadata).toEqual({ custom_key: "unquoted value" });
    expect(result.source.rawBytes).toBe(raw);
    expect(result.source.rawText).toContain("\r\n");
  });

  it("keeps updated independent from reinforce_count and preserves whitespace-only body", () => {
    const result = normalizeLegacySource("entries/global/profile/a.md", bytes(entry("updated: 2026-08-20T02:02:03.000+08:00\r\n", "  ")));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.updatedAt).toBe("2026-08-20T02:02:03.000+08:00");
      expect(result.source.reinforceCount).toBeNull();
      expect(result.source.content).toBe("  ");
    }
  });

  it("rejects present-but-empty optional timestamps instead of treating them as absent", () => {
    const result = normalizeLegacySource(
      "entries/global/profile/a.md",
      bytes(entry("updated: \"\"\r\n")),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.code).toBe("INVALID_TIMESTAMP");
  });

  it("enforces canonical metadata key and count bounds", () => {
    const longKey = `a${"x".repeat(128)}`;
    const result = normalizeLegacySource(
      "entries/global/profile/a.md",
      bytes(entry(`${longKey}: value\r\n`)),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.code).toBe("METADATA_BOUND_EXCEEDED");
  });

  it.each([
    ["entries/global/profile/a.md", "layer: activity", "INVALID_PLACEMENT"],
    ["entries/global/profile/a.md", "disclosure: 12", "CANONICAL_SCHEMA_MISMATCH"],
    ["entries/global/profile/a.md", "emotional_weight: \"2\"", "CANONICAL_SCHEMA_MISMATCH"],
  ])("rejects invalid live field/placement semantics (%s)", (path, field, code) => {
    const source = field.startsWith("layer:") ? entry().replace("layer: profile", field) : entry(`${field}\r\n`);
    const result = normalizeLegacySource(path, bytes(source));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.code).toBe(code);
  });

  it("normalizes canonical retained content newlines without changing raw evidence", () => {
    const raw = bytes(entry("", "first\r\nsecond\rthird"));
    const result = normalizeLegacySource("entries/global/profile/a.md", raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.content).toBe("first\nsecond\nthird");
      expect(result.source.rawText).toContain("\r\n");
      expect(result.source.rawBytes).toBe(raw);
    }
  });

  it("normalizes registered Blocks while preserving raw evidence and note-stripped empty", () => {
    const result = normalizeLegacySource("blocks/global/user-card.md", bytes("> editor note\n"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source.kind).toBe("block");
      expect(result.source.content).toBe("");
      expect(result.source.blockWriter).toBe("user");
    }
  });

  it.each([
    ["entries/global/profile/a.md", new Uint8Array([0xef, 0xbb, 0xbf, 45]), "UNSUPPORTED_BOM"],
    ["entries/global/profile/a.md", bytes("---\nid: a\nid: b\n---\nx"), "DUPLICATE_FRONTMATTER_KEY"],
    ["entries/global/relationship/a.md", bytes(entry().replace("layer: profile", "layer: relationship")), "OWNERSHIP_MISMATCH"],
    ["blocks/global/memory-index.md", bytes("body"), "BLOCK_SCOPE_MISMATCH"],
  ])("returns closed diagnostics for exceptional evidence", (path, raw, code) => {
    const result = normalizeLegacySource(path, raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.code).toBe(code);
  });

  it("refuses credentials and hidden envelopes but preserves ordinary contact text", () => {
    expect(sanitizeLegacyRetainText("email me at a@example.com or 123-456").ok).toBe(true);
    expect(sanitizeLegacyRetainText("api_key = abcdefghijklmnop").ok).toBe(false);
    expect(sanitizeLegacyRetainText("<system>hidden</system>").ok).toBe(false);
  });
});
