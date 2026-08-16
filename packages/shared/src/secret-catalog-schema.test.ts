/**
 * INPUT:  candidate secret.* param/result instances (valid + invalid shapes from the frozen contract)
 * OUTPUT: asserts strict parse/reject behavior, write-only result shapes, and ref charset bounds
 * POS:    shared — the standalone secret-catalog schema test (operator-only surface; deliberately NOT in
 *         protocol-fixtures.test.ts — no Rust serde mirror exists for secret.* frames)
 */
import { describe, expect, it } from "vitest";
import {
  SECRET_METHODS,
  SecretClearResultSchema,
  SecretListResultSchema,
  SecretPresenceResultSchema,
  SecretRefSchema,
  SecretSetParamsSchema,
  SecretSetResultSchema,
} from "./secret-catalog-schema.ts";

describe("SecretRefSchema", () => {
  it.each([
    "mcp.github-mcp.env.GITHUB_TOKEN",
    "mcp.search.header.X-Api-Key",
    "provider.openai.key",
  ])("accepts %s", (ref) => {
    expect(SecretRefSchema.safeParse(ref).success).toBe(true);
  });

  it.each([
    "", // empty
    "mcp", // domain only — a ref must name at least one segment
    "MCP.x.env.K", // domain must be lowercase
    "mcp..env.K", // empty segment
    "mcp.x.env.", // trailing separator
    ".mcp.x.env.K", // leading separator
    "mcp.x.env.K$", // illegal character
    `mcp.${"a".repeat(250)}.env.K`, // over the length bound
  ])("rejects %s", (ref) => {
    expect(SecretRefSchema.safeParse(ref).success).toBe(false);
  });
});

describe("secret.set", () => {
  it("parses a well-formed write request", () => {
    expect(SecretSetParamsSchema.safeParse({
      secretRef: "mcp.github-mcp.env.GITHUB_TOKEN",
      value: "sentinel-not-a-real-secret",
    }).success).toBe(true);
  });

  it("rejects empty and oversized values without echoing them", () => {
    const tooBig = SecretSetParamsSchema.safeParse({ secretRef: "mcp.x.env.K", value: "x".repeat(64 * 1024 + 1) });
    expect(tooBig.success).toBe(false);
    if (!tooBig.success) {
      expect(JSON.stringify(tooBig.error.issues)).not.toContain("x".repeat(32));
    }
    expect(SecretSetParamsSchema.safeParse({ secretRef: "mcp.x.env.K", value: "" }).success).toBe(false);
  });

  it("result is write-only: presence + provenance + health, and rejects any value field", () => {
    expect(SecretSetResultSchema.safeParse({
      secretRef: "mcp.x.env.K",
      present: true,
      provenance: { source: "catalog", keyVersion: 1, updatedAt: "2026-08-16T00:00:00.000Z" },
      health: "ok",
    }).success).toBe(true);
    // A smuggled value field must be rejected (strictObject), and present must be literal true.
    expect(SecretSetResultSchema.safeParse({
      secretRef: "mcp.x.env.K",
      present: true,
      provenance: { source: "catalog", keyVersion: 1, updatedAt: "2026-08-16T00:00:00.000Z" },
      health: "ok",
      value: "sentinel-not-a-real-secret",
    }).success).toBe(false);
    expect(SecretSetResultSchema.safeParse({
      secretRef: "mcp.x.env.K",
      present: false,
      provenance: { source: "catalog", keyVersion: 1, updatedAt: "2026-08-16T00:00:00.000Z" },
      health: "ok",
    }).success).toBe(false);
  });
});

describe("secret.clear / presence / list", () => {
  it("clear result carries only the ref and present:false", () => {
    expect(SecretClearResultSchema.safeParse({ secretRef: "mcp.x.env.K", present: false }).success).toBe(true);
    expect(SecretClearResultSchema.safeParse({ secretRef: "mcp.x.env.K", present: true }).success).toBe(false);
    expect(SecretClearResultSchema.safeParse({ secretRef: "mcp.x.env.K", present: false, value: "x" }).success).toBe(false);
  });

  it("presence result distinguishes known-absent from unknown (locked) stores", () => {
    expect(SecretPresenceResultSchema.safeParse({
      secretRef: "mcp.x.env.K", present: false, provenance: null, health: "locked",
    }).success).toBe(true);
    expect(SecretPresenceResultSchema.safeParse({
      secretRef: "mcp.x.env.K", present: true,
      provenance: { source: "legacy-plaintext", keyVersion: 1, updatedAt: "2026-08-16T00:00:00.000Z" },
      health: "ok",
    }).success).toBe(true);
    expect(SecretPresenceResultSchema.safeParse({
      secretRef: "mcp.x.env.K", present: false, provenance: null, health: "not-a-health",
    }).success).toBe(false);
  });

  it("list result is an entry array plus catalog health, nothing value-shaped", () => {
    const valid = {
      health: "ok",
      entries: [{ secretRef: "mcp.x.env.K", present: true, provenance: null, health: "ok" }],
    };
    expect(SecretListResultSchema.safeParse(valid).success).toBe(true);
    expect(SecretListResultSchema.safeParse({ ...valid, secrets: [] }).success).toBe(false);
  });

  it("method names are frozen under the secret. family", () => {
    expect(SECRET_METHODS).toEqual({
      set: "secret.set",
      clear: "secret.clear",
      presence: "secret.presence",
      list: "secret.list",
    });
  });
});
