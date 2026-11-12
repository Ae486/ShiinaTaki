import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from "@taki/shared";
import { loadServerConfig } from "./server-config.ts";

describe("loadServerConfig", () => {
  it("applies defaults when optional vars are absent", () => {
    const config = loadServerConfig({});
    expect(config).toMatchObject({ host: DEFAULT_WS_HOST, port: DEFAULT_WS_PORT, logLevel: "info" });
    expect(config.dataDir).toBe(join(homedir(), ".takiagent"));
    // The prompt-dir default resolves to the repo prompt/ library (OS-neutral, from import.meta.url).
    expect(config.promptDir.length).toBeGreaterThan(0);
    expect(config.promptDir.replace(/[/\\]$/, "").endsWith("prompt")).toBe(true);
    // Loopback reachability does not grant identity; native local admission is authenticated.
    expect(config.trustLoopbackOperator).toBe(false);
  });

  it("reads provided values and coerces the port", () => {
    expect(
      loadServerConfig({
        TAKI_WS_HOST: "127.0.0.1",
        TAKI_WS_PORT: "9000",
        TAKI_LOG_LEVEL: "debug",
        TAKI_DATA_DIR: "/tmp/taki",
        TAKI_PROMPT_DIR: "/tmp/prompt",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 9000,
      logLevel: "debug",
      dataDir: "/tmp/taki",
      promptDir: "/tmp/prompt",
      trustLoopbackOperator: false,
    });
  });

  it("reads TAKI_DATA_DIR when provided", () => {
    expect(loadServerConfig({ TAKI_DATA_DIR: "/custom/root" }).dataDir).toBe("/custom/root");
  });

  it("rejects a non-numeric port", () => {
    expect(() => loadServerConfig({ TAKI_WS_PORT: "abc" })).toThrow();
  });

  it("rejects an out-of-range port", () => {
    expect(() => loadServerConfig({ TAKI_WS_PORT: "70000" })).toThrow();
  });

  it("rejects an unknown log level", () => {
    expect(() => loadServerConfig({ TAKI_LOG_LEVEL: "verbose" })).toThrow();
  });

  it("rejects wildcard hosts (no auth exists yet)", () => {
    expect(() => loadServerConfig({ TAKI_WS_HOST: "0.0.0.0" })).toThrow(/wildcard/);
    expect(() => loadServerConfig({ TAKI_WS_HOST: "::" })).toThrow(/wildcard/);
  });

  it('parses the loopback auto-trust kill switch strictly (case-insensitive "true"/"1"/"false"/"0")', () => {
    expect(loadServerConfig({ TAKI_TRUST_LOOPBACK_OPERATOR: "false" }).trustLoopbackOperator).toBe(false);
    expect(loadServerConfig({ TAKI_TRUST_LOOPBACK_OPERATOR: "0" }).trustLoopbackOperator).toBe(false);
    expect(loadServerConfig({ TAKI_TRUST_LOOPBACK_OPERATOR: "False" }).trustLoopbackOperator).toBe(false);
    expect(loadServerConfig({ TAKI_TRUST_LOOPBACK_OPERATOR: "true" }).trustLoopbackOperator).toBe(true);
    expect(loadServerConfig({ TAKI_TRUST_LOOPBACK_OPERATOR: "1" }).trustLoopbackOperator).toBe(true);
    // Set-but-empty behaves as unset (default off) — a stray `VAR=` must not brick the boot.
    expect(loadServerConfig({ TAKI_TRUST_LOOPBACK_OPERATOR: "" }).trustLoopbackOperator).toBe(false);
  });

  it("rejects an unrecognized auto-trust value — a typo'd disable must fail the boot, never silently mean ON", () => {
    expect(() => loadServerConfig({ TAKI_TRUST_LOOPBACK_OPERATOR: "off" })).toThrow();
    expect(() => loadServerConfig({ TAKI_TRUST_LOOPBACK_OPERATOR: "no" })).toThrow();
  });
});
