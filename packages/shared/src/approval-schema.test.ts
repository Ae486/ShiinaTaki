import { describe, expect, it } from "vitest";
import {
  APPROVAL_METHODS,
  ApprovalRequestSchema,
  ApprovalRespondParamsSchema,
  ApprovalRespondResultSchema,
} from "./approval-schema.ts";

describe("approval schema (T1)", () => {
  it("names the two methods", () => {
    expect(APPROVAL_METHODS.request).toBe("approval.request");
    expect(APPROVAL_METHODS.respond).toBe("approval.respond");
  });

  it("parses a valid request with an arbitrary input payload", () => {
    const parsed = ApprovalRequestSchema.parse({
      approvalId: "a1",
      serverName: "files",
      toolName: "read",
      input: { path: "/x", nested: [1, 2] },
    });
    expect(parsed.toolName).toBe("read");
    expect(parsed.input).toEqual({ path: "/x", nested: [1, 2] });
  });

  it("rejects a request missing the approvalId", () => {
    expect(ApprovalRequestSchema.safeParse({ serverName: "files", toolName: "read" }).success).toBe(false);
  });

  it("parses the three response scopes and rejects a bad scope", () => {
    for (const scope of ["once", "session", "always"] as const) {
      expect(ApprovalRespondParamsSchema.safeParse({ approvalId: "a1", approved: true, scope }).success).toBe(true);
    }
    expect(ApprovalRespondParamsSchema.safeParse({ approvalId: "a1", approved: true, scope: "forever" }).success).toBe(
      false,
    );
  });

  it("rejects a response missing the approvalId or approved flag", () => {
    expect(ApprovalRespondParamsSchema.safeParse({ approved: true, scope: "once" }).success).toBe(false);
    expect(ApprovalRespondParamsSchema.safeParse({ approvalId: "a1", scope: "once" }).success).toBe(false);
  });

  it("parses the accepted result", () => {
    expect(ApprovalRespondResultSchema.parse({ accepted: false })).toEqual({ accepted: false });
  });
});
