import { describe, expect, it } from "vitest";
import { createTidyIssueLedger } from "./tidy-issues.ts";

describe("tidy rejected-call resolution", () => {
  it("requires explicit evidence after an invalid reference and a later successful correction", () => {
    const ledger = createTidyIssueLedger();
    const issue = ledger.reject({ toolName: "memory_refile", callId: "bad", code: "MEMORY_INVALID_REQUEST", stage: "reference" });
    ledger.success({ toolName: "memory_refile", callId: "fixed" });
    expect(ledger.pending()).toHaveLength(1);
    expect(ledger.resolve([{ issueId: issue.issueId!, status: "corrected", correctedBy: "invented" }])).toBe(false);
    expect(ledger.resolve([{ issueId: issue.issueId!, status: "corrected", correctedBy: "fixed" }])).toBe(true);
    expect(ledger.pending()).toEqual([]);
    expect(ledger.recovered()).toBe(1);
  });

  it("never forgives unknown effects, old successes or an unrelated tool", () => {
    const ledger = createTidyIssueLedger();
    ledger.success({ toolName: "memory_refile", callId: "old" });
    const issue = ledger.reject({ toolName: "memory_refile", callId: "bad", code: "MEMORY_INVALID_REQUEST", stage: "reference" });
    ledger.success({ toolName: "memory_reinforce", callId: "unrelated" });
    for (const correctedBy of ["old", "unrelated"]) {
      expect(ledger.resolve([{ issueId: issue.issueId!, status: "corrected", correctedBy }])).toBe(false);
    }
    const unknown = ledger.reject({ toolName: "memory_refile", callId: "unknown", code: "MEMORY_INTERNAL_ERROR", stage: "write" });
    expect(ledger.resolve([{ issueId: unknown.issueId!, status: "not-needed", reason: "mistaken-request" }])).toBe(false);
    expect(ledger.pending()).toHaveLength(2);
  });

  it("allows an explicit not-needed disposition for a known no-write request", () => {
    const ledger = createTidyIssueLedger();
    const issue = ledger.reject({ toolName: "memory_refile", callId: "bad", code: "MEMORY_INVALID_REQUEST", stage: "input" });
    expect(ledger.resolve([{ issueId: issue.issueId!, status: "not-needed", reason: "already-satisfied" }])).toBe(true);
    expect(ledger.recovered()).toBe(0);
    expect(ledger.skipped()).toBe(1);
  });
});
