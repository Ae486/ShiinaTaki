import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_METHODS, MODEL_CAPABILITIES_METHOD, JSON_RPC_APP_ERROR, type ConfigEntry } from "@taki/shared";
import { createConfigSource } from "../../config/config-source.ts";
import { createConfigSubscriptions } from "../../config/config-subscriptions.ts";
import { createConfigWriter } from "../../config/config-writer.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createLogger } from "../../logging/logger.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext, type MethodRegistry } from "../method-registry.ts";
import { registerConfigMethods } from "./config-methods.ts";

const logger = createLogger("fatal"); // keep test output clean

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

interface FakeCtx extends MethodContext {
  notified: Array<{ method: string; params: unknown }>;
  fireClose(): void;
}
function fakeCtx(): FakeCtx {
  const notified: Array<{ method: string; params: unknown }> = [];
  let onCloseCb: (() => void) | undefined;
  const connection: Connection = {
    state: { status: "authenticated", deviceId: "d1", role: "operator", capabilities: [] },
  };
  return {
    notify: (method, params) => notified.push({ method, params }),
    connection,
    close: () => undefined,
    onClose: (cb) => {
      onCloseCb = cb;
    },
    notified,
    fireClose: () => onCloseCb?.(),
  };
}

function build(env: Record<string, string | undefined> = {}): MethodRegistry {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  const repo = createConfigRepo(db);
  const subscriptions = createConfigSubscriptions();
  const registry = createMethodRegistry();
  registerConfigMethods(registry, {
    source: createConfigSource({ env, repo }),
    writer: createConfigWriter({ env, repo, onChanged: (change) => subscriptions.publish(change) }),
    subscriptions,
    logger,
  });
  return registry;
}

let nextId = 0;
async function call(registry: MethodRegistry, request: { method: string; params: unknown }, ctx = fakeCtx()) {
  return registry.dispatch({ jsonrpc: "2.0", id: ++nextId, method: request.method, params: request.params }, ctx);
}

function entriesOf(response: unknown): ConfigEntry[] {
  return (response as { result: { entries: ConfigEntry[] } }).result.entries;
}

describe("config methods", () => {
  it("reads unconfigured model capabilities separately from the ordinary config list", async () => {
    expect(await call(build(), { method: MODEL_CAPABILITIES_METHOD, params: {} })).toMatchObject({
      result: { apply: "restart", catalog: { status: "unknown", reason: "unconfigured" }, adapter: { nativeWebSearch: false } },
    });
  });
  it("config.list reports every knob with its effective value", async () => {
    const registry = build({ TAKI_WS_PORT: "9100" });
    const entries = entriesOf(await call(registry, { method: CONFIG_METHODS.list, params: {} }));

    expect(entries.length).toBeGreaterThan(30);
    expect(entries.find((row) => row.key === "TAKI_WS_PORT")).toMatchObject({ value: 9100, envLocked: false, origin: "env" });
    expect(entries.find((row) => row.key === "TAKI_MAX_STEPS")).toMatchObject({ value: 10, apply: "live" });
    expect(entries.find((row) => row.key === "TAKI_RPC_INTERACTIVE_TIMEOUT_MS")).toMatchObject({
      value: 15_000,
      apply: "live",
      input: { kind: "int", min: 1 },
    });
  });

  it("config.set rejects a cross-field-invalid timing update", async () => {
    const response = (await call(build(), {
      method: CONFIG_METHODS.set,
      params: { key: "TAKI_RECONNECT_CAP_MS", value: 400 },
    })) as { error: { data: { reason: string }; message: string } };
    expect(response.error.data.reason).toBe("invalid-value");
    expect(response.error.message).toContain("timing policy is inconsistent");
  });

  it("config.list masks secrets: presence only, never the value", async () => {
    const registry = build({ TAKI_PROVIDER_API_KEY: "sk-secret" });
    const response = await call(registry, { method: CONFIG_METHODS.list, params: {} });

    expect(entriesOf(response).find((row) => row.key === "TAKI_PROVIDER_API_KEY")).toMatchObject({
      secret: true,
      secretSet: true,
      value: null,
    });
    expect(JSON.stringify(response)).not.toContain("sk-secret");
  });

  it("config.set persists, and config.list then reports the stored value", async () => {
    const registry = build();
    expect(await call(registry, { method: CONFIG_METHODS.set, params: { key: "TAKI_MAX_STEPS", value: 22 } })).toMatchObject({
      result: { status: "ok", key: "TAKI_MAX_STEPS", value: 22, apply: "live" },
    });

    expect(entriesOf(await call(registry, { method: CONFIG_METHODS.list, params: {} })).find((row) => row.key === "TAKI_MAX_STEPS")).toMatchObject({
      value: 22,
      stored: true,
    });
  });

  it("a subscriber receives a config.changed push for every successful set", async () => {
    const registry = build();
    const ctx = fakeCtx();
    await call(registry, { method: CONFIG_METHODS.subscribe, params: {} }, ctx);

    await call(registry, { method: CONFIG_METHODS.set, params: { key: "TAKI_MAX_STEPS", value: 22 } });
    await call(registry, { method: CONFIG_METHODS.set, params: { key: "TAKI_MAX_STEPS", value: null } });

    expect(ctx.notified).toEqual([
      { method: CONFIG_METHODS.changed, params: { key: "TAKI_MAX_STEPS", value: 22 } },
      { method: CONFIG_METHODS.changed, params: { key: "TAKI_MAX_STEPS", value: null } },
    ]);
  });

  it("a refused set pushes nothing, and a closed socket stops receiving", async () => {
    const registry = build();
    const ctx = fakeCtx();
    await call(registry, { method: CONFIG_METHODS.subscribe, params: {} }, ctx);

    await call(registry, { method: CONFIG_METHODS.set, params: { key: "TAKI_WS_PORT", value: 0 } });
    expect(ctx.notified).toEqual([]);

    ctx.fireClose();
    await call(registry, { method: CONFIG_METHODS.set, params: { key: "TAKI_MAX_STEPS", value: 22 } });
    expect(ctx.notified).toEqual([]);
  });

  it.each([
    ["unknown-key", {}, { key: "TAKI_NOT_A_KNOB", value: 1 }],
    ["invalid-value", {}, { key: "TAKI_WS_PORT", value: 0 }],
    ["secret", {}, { key: "TAKI_PROVIDER_API_KEY", value: "sk-x" }],
    ["env-only", {}, { key: "TAKI_DATA_DIR", value: "C:/x" }],
  ] as const)("config.set refuses %s as a distinct app error", async (reason, env, params) => {
    const registry = build(env);
    const response = (await call(registry, { method: CONFIG_METHODS.set, params })) as {
      error: { code: number; data: { code: string; reason: string } };
    };

    expect(response.error.code).toBe(JSON_RPC_APP_ERROR);
    expect(response.error.data).toMatchObject({ code: "CONFIG_REFUSED", reason });

    const stored = entriesOf(await call(registry, { method: CONFIG_METHODS.list, params: {} })).filter((row) => row.stored);
    expect(stored).toEqual([]);
  });

  it("saves over an environment fallback and echoes the real fallback on reset", async () => {
    const registry = build({ TAKI_MAX_STEPS: "7" });
    expect(await call(registry, { method: CONFIG_METHODS.set, params: { key: "TAKI_MAX_STEPS", value: 22 } }))
      .toMatchObject({ result: { value: 22, effectiveValue: 22, origin: "stored" } });
    expect(await call(registry, { method: CONFIG_METHODS.set, params: { key: "TAKI_MAX_STEPS", value: null } }))
      .toMatchObject({ result: { value: null, effectiveValue: 7, origin: "env" } });
  });

  it("config.set rejects a composite value before the handler runs", async () => {
    const response = (await call(build(), {
      method: CONFIG_METHODS.set,
      params: { key: "TAKI_MAX_STEPS", value: { a: 1 } },
    })) as {
      error: { message: string };
    };
    expect(response.error.message).toBe("Invalid params");
  });

  it("every config method is operator-only", async () => {
    const registry = build();
    const ctx = fakeCtx();
    ctx.connection.state = { status: "authenticated", deviceId: "d1", role: "node", capabilities: [] };

    // Params are validated before the role gate, so each method gets a VALID payload here.
    const calls = [
      [CONFIG_METHODS.list, {}],
      [CONFIG_METHODS.set, { key: "TAKI_MAX_STEPS", value: 22 }],
      [CONFIG_METHODS.subscribe, {}],
      [MODEL_CAPABILITIES_METHOD, {}],
    ] as const;
    for (const [method, params] of calls) {
      const response = (await call(registry, { method, params }, ctx)) as { error: { data: { code: string } } };
      expect(response.error.data.code).toBe("FORBIDDEN");
    }
  });
});
