/**
 * INPUT:  a real core process (withStack; MCP is Core-local so no node is spawned; devTrigger for the L1 governed
 *         drive; secretMasterKey for the encrypted-catalog paths; the stdio MCP fixture as a real child server)
 * OUTPUT: process proofs for the Secure MCP Lifecycle: add/test(no publish)/edit(conflict+retry) all land with NO
 *         restart; a real governed tool call runs through Approval; disable blocks new turns; a Core restart
 *         reconciles from desired state only (fresh generation lineage, never restored runtime truth); a cleared
 *         or locked catalog secret retires ONLY the referencing server while unrelated servers stay live; the
 *         legacy mcp-servers.json seeds desired state once and is inert afterwards
 * POS:    e2e — the MCP lifecycle scenario against the real WS protocol (unit suites own the lease/drain proofs)
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JsonRpcErrorResponseSchema,
  JsonRpcSuccessResponseSchema,
  MCP_METHODS,
  SECRET_METHODS,
  type McpListResult,
} from "@taki/shared";
import { CORE_DIR } from "./fixture/paths.ts";
import { awaitApprovalRequest, respondApproval, triggerCapability } from "./fixture/operator-drivers.ts";
import { withStack, type Stack } from "./fixture/with-stack.ts";

const FIXTURE = join(CORE_DIR, "src", "testing", "mcp-fixture.mjs");
const SENTINEL = "e2e-mcp-secret-sentinel-4a7b9c";
const SECRET_REF = "mcp.sec.env.TOKEN";

async function resultOf<T = Record<string, unknown>>(stack: Stack, method: string, params: unknown): Promise<T> {
  const operator = await stack.operator();
  const frame = await operator.request(method, params);
  return JsonRpcSuccessResponseSchema.parse(frame).result as T;
}

async function errorOf(stack: Stack, method: string, params: unknown): Promise<{ code: number; data: unknown; message: string }> {
  const operator = await stack.operator();
  const frame = await operator.request(method, params);
  const error = JsonRpcErrorResponseSchema.parse(frame).error;
  return { code: error.code, data: error.data, message: error.message };
}

async function listView(stack: Stack): Promise<McpListResult["servers"]> {
  return (await resultOf<McpListResult>(stack, MCP_METHODS.list, {})).servers;
}

async function waitForPhase(stack: Stack, serverId: string, phase: string): Promise<McpListResult["servers"][number]> {
  const timeoutMs = 20_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const server = (await listView(stack)).find((entry) => entry.serverId === serverId);
    if (server?.status.phase === phase) return server;
    if (Date.now() > deadline) throw new Error(`server ${serverId} never reached phase ${phase} (now ${JSON.stringify(server?.status.phase)})`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function stdioFixture(): { command: string; args: string[] } {
  return { command: process.execPath, args: [FIXTURE] };
}

describe("secure MCP lifecycle (real core process)", () => {
  it("add → test (no publish) → governed call through Approval → edit conflict + retry → disable/enable, all without a restart", async () => {
    await withStack({ provider: "dummy", startNode: false, devTrigger: true, secretMasterKey: true }, async (stack) => {
      const operator = await stack.operator();

      // --- add: the awaited candidate publishes generation 1 with the fixture's echo tool ---
      const added = await resultOf(stack, MCP_METHODS.add, { serverId: "e2e", config: stdioFixture() });
      expect(added).toMatchObject({ server: { serverId: "e2e", configRevision: 1, status: { phase: "connected", runtimeGeneration: 1, toolCount: 1 } } });

      // --- test: diagnostics only — the live generation is NOT republished and NOT exposed ---
      const tested = await resultOf(stack, MCP_METHODS.test, { serverId: "e2e" });
      expect(tested).toMatchObject({ status: "ok", toolNames: ["echo"], pages: 1 });
      const afterTest = await resultOf(stack, MCP_METHODS.get, { serverId: "e2e" });
      expect(afterTest).toMatchObject({ server: { status: { phase: "connected", runtimeGeneration: 1 } } });

      // --- a real governed tool call through Approval: standard level asks, the operator allows once ---
      const outcome = triggerCapability(operator, { capability: "e2e_echo", input: { text: "hello" }, interactive: true, timeoutMs: 60_000 });
      const prompt = await awaitApprovalRequest(operator);
      expect(prompt.presentation.capabilityLabel).toBe("echo");
      expect(prompt.presentation.subjectLabel).toBe("e2e");
      const acknowledged = respondApproval(operator, {
        approvalId: prompt.approvalId,
        choice: "allow_once",
        expectedApprovalGeneration: prompt.approvalGeneration,
      });
      expect((await acknowledged).status).toBe("accepted");
      const settled = await outcome;
      expect(settled).toMatchObject({ content: [{ type: "text", text: "echo: hello" }] });

      // --- edit: a stale revision refuses with the current one; the retry succeeds and republishes ---
      const firstEdit = await resultOf(stack, MCP_METHODS.edit, {
        serverId: "e2e", config: { ...stdioFixture(), args: [...stdioFixture().args, "--flag"] },
        selectedTools: [], expectedConfigRevision: 1,
      });
      expect(firstEdit).toMatchObject({ server: { configRevision: 2, status: { phase: "connected", runtimeGeneration: 2 } } });
      const stale = await errorOf(stack, MCP_METHODS.edit, {
        serverId: "e2e", config: stdioFixture(), selectedTools: [], expectedConfigRevision: 1,
      });
      expect(stale.code).toBe(-32000);
      expect(stale.data).toEqual({ code: "MCP_CONFIG_CONFLICT", currentConfigRevision: 2 });
      const retried = await resultOf(stack, MCP_METHODS.edit, {
        serverId: "e2e", config: stdioFixture(), selectedTools: ["echo"], expectedConfigRevision: 2,
      });
      expect(retried).toMatchObject({ server: { configRevision: 3, selectedTools: ["echo"], status: { phase: "connected" } } });

      // --- disable blocks the tool from new turns; enable republishes — same process throughout ---
      await resultOf(stack, MCP_METHODS.disable, { serverId: "e2e", expectedConfigRevision: 3 });
      expect(await waitForPhase(stack, "e2e", "disabled")).toMatchObject({ enabled: false });
      const unreachable = await resultOf(stack, "capability.trigger", { capability: "e2e_echo" });
      expect(unreachable).toMatchObject({ ok: false, code: "UNSUPPORTED_CAPABILITY" });
      await resultOf(stack, MCP_METHODS.enable, { serverId: "e2e", expectedConfigRevision: 4 });
      expect(await waitForPhase(stack, "e2e", "connected")).toMatchObject({ enabled: true });

      // --- crash/restart: desired truth reconciles; runtime generations start a FRESH lineage ---
      await stack.restartCore();
      const reconciled = await waitForPhase(stack, "e2e", "connected");
      expect(reconciled.configRevision).toBe(5); // the desired row survived; nothing else replayed
      expect(reconciled.status.runtimeGeneration).toBe(1); // process-local counter restarted — never restored
    });
  }, 300_000);

  it("a cleared secret retires only the referencing server; a locked catalog skips only affected servers truthfully", async () => {
    await withStack({ provider: "dummy", startNode: false, secretMasterKey: true }, async (stack) => {
      // Store the secret, then add a server whose env carries the OPAQUE ref plus an unrelated plain server.
      await resultOf(stack, SECRET_METHODS.set, { secretRef: SECRET_REF, value: SENTINEL });
      await resultOf(stack, MCP_METHODS.add, {
        serverId: "sec", config: { ...stdioFixture(), env: { TOKEN: `secret-ref:${SECRET_REF}` } },
      });
      await resultOf(stack, MCP_METHODS.add, { serverId: "plain", config: stdioFixture() });
      expect(await waitForPhase(stack, "sec", "connected")).toMatchObject({ serverId: "sec" });
      expect(await waitForPhase(stack, "plain", "connected")).toMatchObject({ serverId: "plain" });

      // --- clear the secret: only the referencing generation retires (truthfully failed, others live) ---
      await resultOf(stack, SECRET_METHODS.clear, { secretRef: SECRET_REF });
      const retired = await waitForPhase(stack, "sec", "failed");
      expect(retired.status.lastOutcome).toMatchObject({ status: "failed", reason: "secret-unresolvable" });
      const plainAfterClear = await resultOf(stack, MCP_METHODS.get, { serverId: "plain" });
      expect(plainAfterClear).toMatchObject({ server: { status: { phase: "connected" } } }); // isolation holds

      // --- restart with the key source REMOVED: the locked catalog skips only secret-dependent servers ---
      await stack.killCore();
      rmSync(join(stack.coreDataDir, "creds"), { recursive: true, force: true });
      await stack.restartCore();

      const lockedSec = await waitForPhase(stack, "sec", "failed");
      expect(lockedSec.status.lastOutcome).toMatchObject({ status: "failed", reason: "secret-unresolvable" });
      expect(await waitForPhase(stack, "plain", "connected")).toMatchObject({ serverId: "plain" }); // boot survived; no fake presence

      // --- privacy: the sentinel never appears in any response or core log ---
      const listFrame = JSON.stringify(await listView(stack));
      expect(listFrame).not.toContain(SENTINEL);
      const logs = `${stack.core.stdout.lines().join("\n")}\n${stack.core.stderr.lines().join("\n")}`;
      expect(logs).not.toContain(SENTINEL);
    });
  }, 300_000);

  it("the legacy mcp-servers.json seeds desired state once (after the secret migration) and is inert afterwards", async () => {
    await withStack(
      {
        provider: "dummy",
        startNode: false,
        secretMasterKey: true,
        seedMcpServers: { "demo-mcp": { ...stdioFixture(), env: { DEMO_TOKEN: SENTINEL } } },
      },
      async (stack) => {
        // Boot ran: plaintext migration rewrote the file, then the (empty-table) seed imported it.
        await stack.waitForCoreLog((entry) => entry.msg === "mcp plaintext secrets migrated to catalog", 30_000);
        await stack.waitForCoreLog((entry) => String(entry.msg).startsWith("legacy mcp-servers.json seeded into desired state"), 30_000);
        const seeded = await waitForPhase(stack, "demo-mcp", "connected");
        expect(seeded.config).toMatchObject({ env: { DEMO_TOKEN: "secret-ref:mcp.demo-mcp.env.DEMO_TOKEN" } });
        expect(JSON.stringify(seeded)).not.toContain(SENTINEL);

        // A later hand-edit of the legacy file changes nothing: the table is authoritative now.
        const configPath = join(stack.coreDataDir, "mcp-servers.json");
        writeFileSync(configPath, JSON.stringify({ rogue: { command: "definitely-not-real" } }, null, 2));
        await stack.restartCore();
        const servers = await listView(stack);
        expect(servers.map((server) => server.serverId)).toEqual(["demo-mcp"]);
        expect(await waitForPhase(stack, "demo-mcp", "connected")).toMatchObject({ configRevision: 1 });
        expect(readFileSync(configPath, "utf8")).toContain("rogue"); // the seed never rewrote the file
      },
    );
  }, 300_000);
});
