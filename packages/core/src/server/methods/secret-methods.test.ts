/**
 * INPUT:  registry dispatch frames (operator/node roles) over a real temp-dir catalog (ok / locked / unreadable)
 * OUTPUT: operator-only role gate, write-only results, sanitized INVALID_PARAMS surfaces, bounded SECRET_REFUSED
 *         reasons, and sentinel-absence probes over every response and log record
 * POS:    core/server/methods — the sensitive-path test at the registry boundary (permission-methods harness style)
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JSON_RPC_APP_ERROR, JSON_RPC_ERROR_CODES, SECRET_METHODS } from "@taki/shared";
import { createCaptureLogger, type CapturedLog } from "../../testing/capture-logger.ts";
import { generateCatalogKey } from "../../secrets/secret-catalog-envelope.ts";
import { createSecretCatalogService, type SecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerSecretMethods } from "./secret-methods.ts";

const STORE = "11111111-1111-4111-8111-111111111111";
const SENTINEL = "sentinel-not-a-real-secret-value-0123456789";
const REF = "mcp.demo.env.API_KEY";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

interface Harness {
  registry: ReturnType<typeof createMethodRegistry>;
  records: CapturedLog[];
  filePath: string;
  service?: SecretCatalogService;
}

function dirSource(key: Uint8Array | null) {
  return { kind: "credentials-directory" as const, canCreate: false, read: () => key, create: () => undefined };
}

async function okHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "taki-secret-methods-"));
  dirs.push(dir);
  const filePath = join(dir, "secret-catalog.bin");
  const capture = createCaptureLogger();
  const service = await createSecretCatalogService({ filePath, storeId: STORE, keySource: dirSource(generateCatalogKey()), logger: capture.logger });
  const registry = createMethodRegistry();
  registerSecretMethods(registry, { service, logger: capture.logger });
  return { registry, records: capture.records, filePath, service };
}

async function lockedHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "taki-secret-methods-"));
  dirs.push(dir);
  const filePath = join(dir, "secret-catalog.bin");
  const capture = createCaptureLogger();
  const service = await createSecretCatalogService({ filePath, storeId: STORE, keySource: null, logger: capture.logger });
  const registry = createMethodRegistry();
  registerSecretMethods(registry, { service, logger: capture.logger });
  return { registry, records: capture.records, filePath };
}

async function unreadableHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "taki-secret-methods-"));
  dirs.push(dir);
  const filePath = join(dir, "secret-catalog.bin");
  const capture = createCaptureLogger();
  // Seed a real catalog under one key, flip a ciphertext byte, then serve methods under another key: unreadable.
  const seeder = await createSecretCatalogService({ filePath, storeId: STORE, keySource: dirSource(generateCatalogKey()), logger: capture.logger });
  seeder.set(REF, SENTINEL);
  const bytes = Buffer.from(readFileSync(filePath));
  const last = bytes.length - 1;
  bytes[last] = (bytes[last] ?? 0) ^ 1;
  writeFileSync(filePath, bytes);
  const service = await createSecretCatalogService({ filePath, storeId: STORE, keySource: dirSource(generateCatalogKey()), logger: capture.logger });
  expect(service.health()).toBe("unreadable");
  const registry = createMethodRegistry();
  registerSecretMethods(registry, { service, logger: capture.logger });
  return { registry, records: capture.records, filePath };
}

let id = 0;
async function call(
  h: Harness,
  spec: { method: string; params: unknown; role?: "operator" | "node" },
): Promise<Record<string, unknown>> {
  const role = spec.role ?? "operator";
  const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role, capabilities: [] } };
  const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
  const response = await h.registry.dispatch({ jsonrpc: "2.0", id: ++id, method: spec.method, params: spec.params }, ctx);
  return response as unknown as Record<string, unknown>;
}

describe("secret methods", () => {
  it("operator set/clear/presence/list return write-only results", async () => {
    const h = await okHarness();
    const set = await call(h, { method: SECRET_METHODS.set, params: { secretRef: REF, value: SENTINEL } });
    expect(set.result).toMatchObject({ secretRef: REF, present: true, health: "ok", provenance: { source: "catalog", keyVersion: 1 } });
    expect(JSON.stringify(set)).not.toContain(SENTINEL);

    const presence = await call(h, { method: SECRET_METHODS.presence, params: { secretRef: REF } });
    expect(presence.result).toMatchObject({ present: true, health: "ok" });
    expect(JSON.stringify(presence)).not.toContain(SENTINEL);

    const list = await call(h, { method: SECRET_METHODS.list, params: {} });
    expect(list.result).toMatchObject({ health: "ok" });
    expect((list.result as { entries: unknown[] }).entries).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(SENTINEL);

    const cleared = await call(h, { method: SECRET_METHODS.clear, params: { secretRef: REF } });
    expect(cleared.result).toEqual({ secretRef: REF, present: false });
  });

  it("keeps every method operator-only (node role is FORBIDDEN)", async () => {
    const h = await okHarness();
    for (const [method, params] of [
      [SECRET_METHODS.set, { secretRef: REF, value: SENTINEL }],
      [SECRET_METHODS.clear, { secretRef: REF }],
      [SECRET_METHODS.presence, { secretRef: REF }],
      [SECRET_METHODS.list, {}],
    ] as const) {
      const response = (await call(h, { method, params, role: "node" })) as { error: { data: { code: string } } };
      expect(response.error.data.code).toBe("FORBIDDEN");
    }
  });

  it("a locked store fails set closed with a bounded reason and no value anywhere in the response", async () => {
    const h = await lockedHarness();
    const response = await call(h, { method: SECRET_METHODS.set, params: { secretRef: REF, value: SENTINEL } });
    const error = (response as { error: { code: number; data: { code: string; reason: string } } }).error;
    expect(error.code).toBe(JSON_RPC_APP_ERROR);
    expect(error.data).toEqual({ code: "SECRET_REFUSED", reason: "store-locked" });
    expect(JSON.stringify(response)).not.toContain(SENTINEL);
    const presence = await call(h, { method: SECRET_METHODS.presence, params: { secretRef: REF } });
    expect(presence.result).toEqual({ secretRef: REF, present: false, provenance: null, health: "locked" });
  });

  it("an unreadable store refuses with store-unreadable and does not rewrite the file", async () => {
    const h = await unreadableHarness();
    const before = readFileSync(h.filePath);
    const response = await call(h, { method: SECRET_METHODS.set, params: { secretRef: REF, value: SENTINEL } });
    const error = (response as { error: { data: { code: string; reason: string } } }).error;
    expect(error.data).toEqual({ code: "SECRET_REFUSED", reason: "store-unreadable" });
    expect(readFileSync(h.filePath).equals(before)).toBe(true);
  });

  it("invalid params echo bounded zod issues WITHOUT the secret value", async () => {
    const h = await okHarness();
    const emptyValue = await call(h, { method: SECRET_METHODS.set, params: { secretRef: REF, value: "" } });
    expect((emptyValue as { error: { code: number } }).error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS);
    expect(JSON.stringify(emptyValue)).not.toContain(SENTINEL);
    const badRef = await call(h, { method: SECRET_METHODS.set, params: { secretRef: "NOT A REF", value: SENTINEL } });
    expect((badRef as { error: { code: number } }).error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS);
    expect(JSON.stringify(badRef)).not.toContain(SENTINEL);
  });

  it("no log record ever carries the sentinel", async () => {
    const h = await okHarness();
    await call(h, { method: SECRET_METHODS.set, params: { secretRef: REF, value: SENTINEL } });
    await call(h, { method: SECRET_METHODS.clear, params: { secretRef: REF } });
    expect(JSON.stringify(h.records)).not.toContain(SENTINEL);
  });
});
