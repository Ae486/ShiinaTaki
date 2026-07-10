import { describe, expect, it } from "vitest";
import { parseApprovalAnswer, renderApprovalAsk } from "./approval-prompt.ts";

describe("parseApprovalAnswer (T22)", () => {
  it("maps each valid key to an approved+scope pair", () => {
    expect(parseApprovalAnswer("y")).toEqual({ approved: true, scope: "once" });
    expect(parseApprovalAnswer("s")).toEqual({ approved: true, scope: "session" });
    expect(parseApprovalAnswer("a")).toEqual({ approved: true, scope: "always" });
    expect(parseApprovalAnswer("d")).toEqual({ approved: false, scope: "once" });
    expect(parseApprovalAnswer("n")).toEqual({ approved: false, scope: "always" }); // deny-always == never
  });

  it("is case- and whitespace-insensitive", () => {
    expect(parseApprovalAnswer("  A ")).toEqual({ approved: true, scope: "always" });
  });

  it("returns null for an unrecognized answer (caller re-prompts)", () => {
    expect(parseApprovalAnswer("")).toBeNull();
    expect(parseApprovalAnswer("maybe")).toBeNull();
    expect(parseApprovalAnswer("q")).toBeNull();
  });
});

describe("renderApprovalAsk", () => {
  it("shows the server, tool, and input so the operator can judge the ask", () => {
    const prompt = renderApprovalAsk({ approvalId: "x", serverName: "files", toolName: "read", input: { path: "/etc" } });
    expect(prompt).toContain("files/read");
    expect(prompt).toContain('{"path":"/etc"}');
  });
});
