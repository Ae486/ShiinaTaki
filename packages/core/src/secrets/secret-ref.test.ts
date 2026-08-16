import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "../mcp/mcp-config.ts";
import { SECRET_REF_MARKER, mcpEnvRef, mcpHeaderRef, parseSecretRefValue, resolveMcpConfigSecrets, sanitizeRefSegment } from "./secret-ref.ts";

const SENTINEL = "sentinel-not-a-real-secret-value-0123456789";
const PLAIN = "not-a-secret-plain-value";

describe("ref derivation", () => {
  it("derives stable opaque refs for env and header fields", () => {
    expect(mcpEnvRef("github-mcp", "GITHUB_TOKEN")).toBe("mcp.github-mcp.env.GITHUB_TOKEN");
    expect(mcpHeaderRef("search", "X-Api-Key")).toBe("mcp.search.header.X-Api-Key");
  });

  it("folds non-ref characters like the tool-key sanitizer", () => {
    expect(sanitizeRefSegment("a.b/c d")).toBe("a_b_c_d");
    expect(mcpEnvRef("files.prod", "API KEY")).toBe("mcp.files_prod.env.API_KEY");
  });
});

describe("parseSecretRefValue", () => {
  it("returns the ref for markers and null for plain values", () => {
    expect(parseSecretRefValue(`${SECRET_REF_MARKER}mcp.x.env.K`)).toBe("mcp.x.env.K");
    expect(parseSecretRefValue(PLAIN)).toBeNull();
    expect(parseSecretRefValue("secret-refish")).toBeNull();
  });
});

describe("resolveMcpConfigSecrets (connect-time resolution)", () => {
  const stdio: McpServerConfig = { command: "node", args: [], env: { TOKEN: `${SECRET_REF_MARKER}mcp.demo.env.API_KEY`, NODE_ENV: PLAIN } };
  const http: McpServerConfig = { url: "https://x.example/mcp", headers: { "X-Api-Key": `${SECRET_REF_MARKER}mcp.demo.header.X_API` } };

  it("resolves markers just-in-time and passes plain values through untouched", () => {
    const resolved = resolveMcpConfigSecrets(stdio, (ref) => (ref === "mcp.demo.env.API_KEY" ? SENTINEL : null));
    expect("command" in resolved && resolved.env).toEqual({ TOKEN: SENTINEL, NODE_ENV: PLAIN });
    const resolvedHeaders = resolveMcpConfigSecrets(http, () => SENTINEL);
    expect(!("command" in resolvedHeaders) && resolvedHeaders.headers).toEqual({ "X-Api-Key": SENTINEL });
  });

  it("keeps absent maps absent", () => {
    const bare: McpServerConfig = { command: "node", args: [] };
    const resolved = resolveMcpConfigSecrets(bare, () => SENTINEL);
    expect("command" in resolved && resolved.env).toBeUndefined();
  });

  it("an unresolvable ref throws with the OPAQUE ref only — never a value, never a partial fallback", () => {
    try {
      resolveMcpConfigSecrets(stdio, () => null);
      expect.unreachable("unresolvable refs must throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("mcp.demo.env.API_KEY");
      expect(message).not.toContain(SENTINEL);
      expect(message).not.toContain(PLAIN);
    }
  });
});
