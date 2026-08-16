/**
 * INPUT:  a real core process (withStack, secretMasterKey: true; no node — secret ops are Core-local)
 * OUTPUT: process-level proofs: set → core restart → presence survives with NO re-provisioning; a removed key
 *         source locks the store and every mutation fails closed immediately (never queues, never rewrites);
 *         boot-time plaintext migration rewrites seeded env/headers to opaque refs; sentinel-absence probes over
 *         responses, core logs, and the on-disk catalog bytes
 * POS:    e2e — the Host-secret-catalog restart/lock/migration scenario against the real WS protocol
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  JsonRpcErrorResponseSchema,
  JsonRpcSuccessResponseSchema,
  SECRET_METHODS,
} from "@taki/shared";
import { withStack, type Stack } from "./fixture/with-stack.ts";

const SENTINEL = "e2e-sentinel-not-a-real-secret-4f1a2b";
const SECOND_SENTINEL = "e2e-sentinel-number-two-9c8d7e";
const REF = "mcp.e2e-demo.env.DEMO_TOKEN";

function coreOutput(stack: Stack): string {
  return `${stack.core.stdout.lines().join("\n")}\n${stack.core.stderr.lines().join("\n")}`;
}

async function resultOf(stack: Stack, method: string, params: unknown): Promise<Record<string, unknown>> {
  const operator = await stack.operator();
  const frame = await operator.request(method, params);
  return JsonRpcSuccessResponseSchema.parse(frame).result as Record<string, unknown>;
}

async function errorOf(stack: Stack, method: string, params: unknown): Promise<{ code: number; data: unknown; message: string }> {
  const operator = await stack.operator();
  const frame = await operator.request(method, params);
  const error = JsonRpcErrorResponseSchema.parse(frame).error;
  return { code: error.code, data: error.data, message: error.message };
}

describe("host secret catalog (real core process)", () => {
  it("set survives a core restart without re-provisioning; a removed key source locks the store fail-closed", async () => {
    await withStack({ provider: "dummy", startNode: false, secretMasterKey: true }, async (stack) => {
      // --- set + immediate presence (write-only result; no sentinel in any frame) ---
      const set = await resultOf(stack, SECRET_METHODS.set, { secretRef: REF, value: SENTINEL });
      expect(set).toMatchObject({ secretRef: REF, present: true, health: "ok", provenance: { source: "catalog", keyVersion: 1 } });
      expect(JSON.stringify(set)).not.toContain(SENTINEL);

      // --- at-rest probe: the catalog file exists and is ciphertext (no plaintext sentinel on disk) ---
      const catalogPath = join(stack.coreDataDir, "secret-catalog.bin");
      expect(existsSync(catalogPath)).toBe(true);
      expect(readFileSync(catalogPath).includes(Buffer.from(SENTINEL))).toBe(false);

      // --- restart the CORE (not the key): presence must survive with no re-provisioning step ---
      await stack.restartCore();
      const afterRestart = await resultOf(stack, SECRET_METHODS.presence, { secretRef: REF });
      expect(afterRestart).toMatchObject({ present: true, provenance: { keyVersion: 1 }, health: "ok" });
      const sealedBeforeLock = readFileSync(catalogPath); // baseline for the never-rewritten-while-locked proof

      // --- remove the ONLY key source and restart again: locked, fail-closed, never re-provisioned ---
      await stack.killCore();
      rmSync(join(stack.coreDataDir, "creds"), { recursive: true, force: true });
      await stack.restartCore();

      const lockedPresence = await resultOf(stack, SECRET_METHODS.presence, { secretRef: REF });
      expect(lockedPresence).toEqual({ secretRef: REF, present: false, provenance: null, health: "locked" });

      // The mutation fails CLOSED immediately — an error response, nothing queued, nothing retried.
      const refusal = await errorOf(stack, SECRET_METHODS.set, { secretRef: REF, value: SECOND_SENTINEL });
      expect(refusal.code).toBe(-32000);
      expect(refusal.data).toEqual({ code: "SECRET_REFUSED", reason: "store-locked" });
      expect(refusal.message).not.toContain(SECOND_SENTINEL);
      // A following read still reports locked (no background queue drained anything into the store).
      expect(await resultOf(stack, SECRET_METHODS.presence, { secretRef: REF })).toMatchObject({ present: false, health: "locked" });

      // --- durability probes: the sealed catalog was never rewritten while locked; no plaintext anywhere ---
      const finalBytes = readFileSync(catalogPath);
      expect(finalBytes.equals(sealedBeforeLock)).toBe(true); // byte-identical through the whole locked phase
      expect(finalBytes.includes(Buffer.from(SENTINEL))).toBe(false);
      expect(finalBytes.includes(Buffer.from(SECOND_SENTINEL))).toBe(false);
      const logs = coreOutput(stack);
      expect(logs).not.toContain(SENTINEL);
      expect(logs).not.toContain(SECOND_SENTINEL);
    });
  }, 180_000);

  it("boot migration rewrites seeded plaintext env/headers into opaque refs after verified copy", async () => {
    await withStack(
      {
        provider: "dummy",
        startNode: false,
        secretMasterKey: true,
        seedMcpServers: {
          "demo-mcp": { command: "node", args: ["missing-server.js"], env: { DEMO_TOKEN: SENTINEL, NODE_ENV: "production" } },
        },
      },
      async (stack) => {
        const configPath = join(stack.coreDataDir, "mcp-servers.json");
        // Boot already ran the migration (withStack resolves on "ws server listening", which comes after it).

        // The migration log line proves the copy-verify-rewrite pass ran (counts only — never values).
        await stack.waitForCoreLog((entry) => entry.msg === "mcp plaintext secrets migrated to catalog", 30_000);

        const rewritten = readFileSync(configPath, "utf8");
        expect(rewritten).not.toContain(SENTINEL); // the plaintext is gone from the source AFTER verification
        expect(rewritten).toContain("secret-ref:mcp.demo-mcp.env.DEMO_TOKEN");

        // The migrated value is present in the catalog and resolvable through the encrypted store.
        const presence = await resultOf(stack, SECRET_METHODS.presence, { secretRef: "mcp.demo-mcp.env.DEMO_TOKEN" });
        expect(presence).toMatchObject({ present: true, health: "ok" });

        // The failing server (command does not exist) degraded to a skip — the companion stayed alive.
        await stack.waitForCoreLog((entry) => entry.msg === "ws server listening", 30_000);
        expect(coreOutput(stack)).not.toContain(SENTINEL);
      },
    );
  }, 180_000);
});
