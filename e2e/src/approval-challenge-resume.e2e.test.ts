/**
 * INPUT: real Core and taki-node processes plus one paired operator socket
 * OUTPUT: process proof of challenge -> operator allow/deny -> resume -> single execution -> lineage settle
 * POS:    e2e — Slice-4 Host Approval vertical; pending input stays private while approved exec uses its audit exception
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  awaitApprovalRequest,
  respondApproval,
  triggerCapability,
} from "./fixture/operator-drivers.ts";
import { withStack, type Stack } from "./fixture/with-stack.ts";

// A single argv command: it parses as one command (no shell metacharacters), is not allowlisted
// (exec:allowlist-miss -> ask at standard), and still runs as a direct child after the resume.
const SENTINEL_COMMAND = "whoami SENTINEL-EXEC-4f2b";

describe("Host approval challenge/resume process lifecycle", () => {
  it("allows once: operator answers the challenge, the Host resumes exactly once, Core settles the lineage", async () => {
    await withStack({ devTrigger: true }, async (stack) => {
      const operator = await stack.operator();
      const outcome = triggerCapability(operator, {
        capability: "exec",
        input: { command: SENTINEL_COMMAND },
        interactive: true,
        timeoutMs: 60_000,
      });

      const prompt = await awaitApprovalRequest(operator);
      expect(prompt.presentation.capabilityLabel).toBe("exec");
      // The challenge presentation is classification-only: the exact command never crosses to the operator frame.
      expect(JSON.stringify(prompt)).not.toContain("SENTINEL-EXEC-4f2b");
      const acknowledged = await respondApproval(operator, {
        approvalId: prompt.approvalId,
        choice: "allow_once",
        expectedApprovalGeneration: prompt.approvalGeneration,
      });
      expect(acknowledged.status).toBe("accepted");

      const settled = await outcome;
      // A nonzero exitCode is a normal exec result — ok:true plus a completed run proves the single execution.
      expect(settled).toMatchObject({ ok: true, exitCode: expect.any(Number) });
      // Lineage settle: Core accepted the terminal frame only after the resume authorization was consumed once.
      await stack.waitForCoreLog((entry) => entry.msg === "capability settled" && entry.ok === true, 10_000);
      expect(stack.countCoreLog((entry) => entry.msg === "capability resume authorized")).toBe(1);
      const execAudit = stack.audit().filter((line) => line.capability === "exec");
      expect(execAudit).toHaveLength(1);
      expect(execAudit[0]?.command).toBe(SENTINEL_COMMAND);
      assertSentinelAbsentFromDiagnostics(stack);
    });
  }, 120_000);

  it("denies once: the operator's deny settles denied and the Host never executes", async () => {
    await withStack({ devTrigger: true }, async (stack) => {
      const operator = await stack.operator();
      const outcome = triggerCapability(operator, {
        capability: "exec",
        input: { command: SENTINEL_COMMAND },
        interactive: true,
        timeoutMs: 60_000,
      });
      const prompt = await awaitApprovalRequest(operator);
      const acknowledged = await respondApproval(operator, {
        approvalId: prompt.approvalId,
        choice: "deny",
        expectedApprovalGeneration: prompt.approvalGeneration,
      });
      expect(acknowledged.status).toBe("accepted");

      await expect(outcome).resolves.toEqual({
        ok: false,
        code: "DENIED",
        message: "approval was not granted",
      });
      expect(stack.countCoreLog((entry) => entry.msg === "capability resume authorized")).toBe(0);
      assertSentinelPrivate(stack);
    });
  }, 120_000);

  it("fails closed without prompting when the turn carries no operator connection", async () => {
    await withStack({ devTrigger: true }, async (stack) => {
      const operator = await stack.operator();
      await expect(triggerCapability(operator, {
        capability: "exec",
        input: { command: SENTINEL_COMMAND },
        timeoutMs: 60_000,
      })).resolves.toEqual({
        ok: false,
        code: "APPROVAL_REQUIRED",
        message: "approval requires an active operator connection",
      });
      expect(operator.notifications().some((note) => note.method === "approval.request")).toBe(false);
      assertSentinelPrivate(stack);
    });
  }, 120_000);
});

// The exact pending command must stay absent from every durable/diagnostic surface the stack exposes.
function assertSentinelPrivate(stack: Stack): void {
  const audit = readAudit(stack.auditPath);
  expect(JSON.stringify(audit)).not.toContain("SENTINEL-EXEC-4f2b");
  assertSentinelAbsentFromDiagnostics(stack);
}

function assertSentinelAbsentFromDiagnostics(stack: Stack): void {
  for (const stream of [stack.core.stdout.lines(), stack.core.stderr.lines()]) {
    expect(stream.join("\n")).not.toContain("SENTINEL-EXEC-4f2b");
  }
  const node = stack.node();
  if (node) expect(node.stderr.lines().join("\n")).not.toContain("SENTINEL-EXEC-4f2b");
}

function readAudit(auditPath: string): unknown[] {
  try {
    return readFileSync(auditPath, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
