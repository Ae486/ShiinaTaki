/**
 * INPUT: real Core and taki-node processes plus one paired operator socket
 * OUTPUT: process proof of challenge -> operator allow/deny -> resume -> single execution -> lineage settle
 * POS:    e2e — D64/Host Approval vertical; permitted display, masked credentials and unchanged original execution audit
 */
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  CapabilityChallengeSchema, CapabilityRequestSchema, ConnectResultSchema,
  HOST_CATALOG_SCHEMA_VERSION, HOST_CONTROL_PROTOCOL_VERSION, JsonRpcErrorResponseSchema, JsonRpcSuccessResponseSchema,
  canonicalApprovalDecisionScope, canonicalCapabilityChallenge, canonicalHostOperationControl, reconstructApprovalCommand,
  type CapabilityRequest,
} from "@taki/shared";
import { describe, expect, it } from "vitest";
import {
  awaitApprovalRequest,
  respondApproval,
  pairLegacyOperator,
  triggerCapability,
} from "./fixture/operator-drivers.ts";
import { withStack, type Stack } from "./fixture/with-stack.ts";
import { openRpcSocket, type RpcSocket } from "./fixture/rpc-socket.ts";

// A single argv command: it parses as one command (no shell metacharacters), is not allowlisted
// (exec:allowlist-miss -> ask at standard), and still runs as a direct child after the resume.
const SENTINEL_COMMAND = `whoami --token=SYNTHETIC-CREDENTIAL-88 ${"x".repeat(501)} SENTINEL-EXEC-4f2b`;

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
      expect(prompt.presentation.capabilityLabel).toBe("执行命令");
      expect(reconstructApprovalCommand(prompt.presentation))
        .toBe(SENTINEL_COMMAND.replace("SYNTHETIC-CREDENTIAL-88", "[凭证已隐藏]"));
      expect(JSON.stringify(prompt)).not.toContain("SYNTHETIC-CREDENTIAL-88");
      expect(prompt.presentation.sections.flatMap((section) => section.fields).length).toBeGreaterThan(1);
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

  it("settles over-capacity and ambiguous disclosures promptly without a prompt, execution or raw audit", async () => {
    await withStack({ devTrigger: true }, async (stack) => {
      const operator = await stack.operator();
      for (const command of [`whoami ${"x".repeat(48_000)} SENTINEL-EXEC-4f2b`, 'whoami --token="SYNTHETIC-CREDENTIAL-88']) {
        const started = Date.now();
        await expect(triggerCapability(operator, { capability: "exec", input: { command }, interactive: true, timeoutMs: 60_000 }))
          .resolves.toMatchObject({ ok: false, code: "DENIED", message: expect.stringContaining("已拒绝执行") });
        expect(Date.now() - started).toBeLessThan(5_000);
      }
      expect(operator.notifications().some((note) => note.method === "approval.request")).toBe(false);
      expect(stack.audit()).toEqual([]);
      expect(stack.countCoreLog((entry) => entry.msg === "capability resume authorized")).toBe(0);
      assertSentinelPrivate(stack);
    });
  }, 120_000);

  it("refuses a legacy initiating operator immediately without sending an unknown-field approval", async () => {
    await withStack({ devTrigger: true }, async (stack) => {
      const legacy = await openRpcSocket(stack.wsUrl);
      const deviceId = randomUUID();
      try {
        await pairLegacyOperator(legacy, { deviceId, deviceName: "d64-legacy-operator", getCode: () => pairingCode(stack, deviceId) });
        const started = Date.now();
        await expect(triggerCapability(legacy, { capability: "exec", input: { command: SENTINEL_COMMAND }, interactive: true, timeoutMs: 60_000 }))
          .resolves.toMatchObject({ ok: false, code: "DENIED", message: expect.stringContaining("操作端版本") });
        expect(Date.now() - started).toBeLessThan(5_000);
        expect(legacy.notifications().some((note) => note.method === "approval.request")).toBe(false);
        expect(stack.audit()).toEqual([]);
        assertSentinelPrivate(stack);
      } finally { legacy.close(); }
    });
  }, 120_000);

  it("refuses a correctly bound legacy Host challenge before prompting or creating a resume", async () => {
    await withStack({ devTrigger: true, startNode: false }, async (stack) => {
      const host = await openRpcSocket(stack.wsUrl);
      try {
        await pairLegacyHost(stack, host);
        const operator = await stack.operator();
        const started = Date.now();
        const outcome = triggerCapability(operator, { capability: "exec", input: { command: SENTINEL_COMMAND }, interactive: true, timeoutMs: 60_000 });
        const request = CapabilityRequestSchema.parse((await host.waitForNotification((note) => note.method === "capability.request")).params);
        const ack = JsonRpcSuccessResponseSchema.parse(await host.request("capability.challenge", legacyChallenge(request))).result;
        expect(ack).toEqual({ accepted: false, reason: "unsupported_version" });
        await expect(outcome).resolves.toMatchObject({ ok: false, code: "DENIED", message: expect.stringContaining("执行端版本") });
        expect(Date.now() - started).toBeLessThan(5_000);
        await host.waitForNotification((note) => note.method === "capability.cancel");
        expect(operator.notifications().some((note) => note.method === "approval.request")).toBe(false);
        expect(host.notifications().some((note) => ["capability.resume", "capability.execute"].includes(note.method))).toBe(false);
        assertSentinelPrivate(stack);
      } finally { host.close(); }
    });
  }, 120_000);
});

async function pairingCode(stack: Stack, deviceId: string): Promise<string> {
  const log = await stack.waitForCoreLog((entry) => entry.msg === "pairing code issued" && entry.deviceId === deviceId);
  return String(log.code);
}

async function pairLegacyHost(stack: Stack, socket: RpcSocket): Promise<void> {
  const deviceId = randomUUID();
  const identity = { deviceId, deviceName: "d64-legacy-host", role: "node", capabilities: ["exec"],
    host: { protocol: { min: HOST_CONTROL_PROTOCOL_VERSION, max: HOST_CONTROL_PROTOCOL_VERSION }, catalogSchemaVersions: [HOST_CATALOG_SCHEMA_VERSION] },
  };
  expect(JsonRpcErrorResponseSchema.parse(await socket.request("connect", identity)).error.data).toMatchObject({ code: "PAIRING_REQUIRED" });
  const result = ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse(await socket.request("connect", {
    ...identity, pairingCode: await pairingCode(stack, deviceId),
  })).result);
  const ack = JsonRpcSuccessResponseSchema.parse(await socket.request("host.catalogPublish", {
    ...result.host, label: "Legacy Host", catalogGeneration: 1, publishedAt: new Date().toISOString(), readiness: "ready",
    capabilities: [{ capabilityId: "exec", execution: "effect", cancellation: "non-cooperative",
      governance: { descriptorRevision: 1, classifierId: "exec-command", classifierRevision: 1 } }],
  })).result;
  expect(ack).toEqual({ accepted: true });
}

function legacyChallenge(request: CapabilityRequest) {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const scope = { bindingRevision: 1 as const, identity: { capabilityId: "exec", ownerHostId: request.control.targetHostId },
    descriptorRevision: 1, classifierId: "exec-command", classifierRevision: 1, cellKey: "exec:allowlist-miss" };
  const challenge = CapabilityChallengeSchema.parse({ requestId: request.requestId, control: request.control,
    challengeId: randomUUID(), controlDigest: hash(canonicalHostOperationControl(request.control)), challengeDigest: "0".repeat(64),
    decisionScopeDigest: hash(canonicalApprovalDecisionScope(scope)),
    governance: { descriptorRevision: 1, classifierRevision: 1, cellKey: scope.cellKey, effectivePosture: "ask", constraint: "none" },
    presentation: { revision: 1, title: "Legacy ask", capabilityLabel: "exec", riskSummary: "Classified by Host",
      sections: [{ title: "Classification", fields: [{ label: "Class", value: "exec" }] }] },
  });
  challenge.challengeDigest = hash(canonicalCapabilityChallenge(challenge));
  return challenge;
}

// The exact pending command must stay absent from every durable/diagnostic surface the stack exposes.
function assertSentinelPrivate(stack: Stack): void {
  const audit = readAudit(stack.auditPath);
  expect(JSON.stringify(audit)).not.toContain("SENTINEL-EXEC-4f2b");
  assertSentinelAbsentFromDiagnostics(stack);
}

function assertSentinelAbsentFromDiagnostics(stack: Stack): void {
  for (const stream of [stack.core.stdout.lines(), stack.core.stderr.lines()]) {
    expect(stream.join("\n")).not.toContain("SENTINEL-EXEC-4f2b");
    expect(stream.join("\n")).not.toContain("SYNTHETIC-CREDENTIAL-88");
  }
  const node = stack.node();
  if (node) {
    expect(node.stderr.lines().join("\n")).not.toContain("SENTINEL-EXEC-4f2b");
    expect(node.stderr.lines().join("\n")).not.toContain("SYNTHETIC-CREDENTIAL-88");
  }
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
